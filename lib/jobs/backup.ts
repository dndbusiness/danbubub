import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sql, withActor } from '@/lib/db'
import { ensureFolderPath, reportFolder, uploadFile } from '@/lib/google/drive'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { settingValues } from '@/lib/queries/cashflow'
import { enqueueOutbox, flushOutbox } from './outbox'
import { runJob } from './run'

type Out = { rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }

const STORAGE = process.env.STORAGE_DIR ?? join(process.cwd(), 'storage')

/**
 * חלק ג' `reports_to_drive` — "אחרי כל הפקה · סעיף 6 שכבה 2".
 * כל דוח שהופק ונשמר מקומית ולא עלה לדרייב — מועלה עכשיו, ו-`report_runs`
 * מתעדכן לקישור. הג'וב idempotent: קובץ שכבר בדרייב לא עולה שוב.
 */
export async function reportsToDriveJob(asOf: string): Promise<Out> {
  return runJob('reports_to_drive', async () => {
    const google = await googleIntegration()
    if (!hasScope(google, 'https://www.googleapis.com/auth/drive.file')) {
      // לא כישלון: זו שכבה 2, והיא מתחילה לעבוד ברגע שגוגל מחובר.
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from report_runs
        where deleted_at is null and file_url is not null and file_url not like 'http%'`
      const n = row?.n ?? 0
      return { rowsTouched: 0, skipped: `גוגל לא מחובר — ${n} דוחות ממתינים להעלאה`, detail: { pending: n } }
    }

    const pending = await sql<{ id: string; report_type: string; period: string | null; file_url: string }[]>`
      select id, report_type, period, file_url from report_runs
      where deleted_at is null and file_url is not null and file_url not like 'http%'
      order by created_at desc limit 50`
    if (!pending.length) return { rowsTouched: 0, skipped: 'אין דוחות שממתינים להעלאה' }

    const token = await googleAccessToken()
    const FOLDER: Record<string, Parameters<typeof reportFolder>[0]> = {
      daily_summary: 'daily', weekly: 'weekly', pnl_draft: 'pnl', pnl_final: 'pnl',
      nissim_settlement: 'nissim', payroll: 'payroll', invoice_gaps: 'pnl',
    }

    let uploaded = 0
    const failed: string[] = []
    for (const r of pending) {
      try {
        const period = r.period ?? asOf.slice(0, 7)
        const folder = await ensureFolderPath(token, reportFolder(FOLDER[r.report_type] ?? 'weekly', period))
        const name = r.file_url.split('/').pop() ?? `${r.report_type}-${period}.pdf`
        const link = (await uploadFile(token, folder, name, 'application/pdf', await readFile(r.file_url))).webViewLink
        await withActor(async (tx) => { await tx`update report_runs set file_url = ${link} where id = ${r.id}` })
        uploaded++
      } catch (e) {
        failed.push(`${r.report_type}: ${(e as Error).message}`)
      }
    }

    // ב.10 — כישלון פותח משימה, לא נעלם בשקט.
    if (failed.length) {
      await withActor(async (tx) => {
        await tx`
          insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
          values (${'העלאת דוחות לדרייב נכשלה'}, ${asOf}, 'normal', true,
                  ${`reports_to_drive_failed:${asOf}`}, ${failed.slice(0, 5).join(' · ')})
          on conflict do nothing`
      })
    }
    return { rowsTouched: uploaded, detail: { uploaded, failed: failed.length } }
  })
}

/**
 * חלק ג' `cold_backup` — "א' 04:00 · סעיף 6 שכבה 3 · עותק".
 * עותק קר שבועי: מאחד את גיבויי ה-DB והדוחות של השבוע לקובץ אחד עם checksum,
 * מעלה לדרייב אם מחובר, ושומר מקומית תמיד. מייל לדן עם מה יש ומה חסר.
 */
export async function coldBackupJob(asOf: string): Promise<Out> {
  return runJob('cold_backup', async () => {
    const dir = join(STORAGE, 'backups')
    await mkdir(dir, { recursive: true })

    const files = await readdir(dir).catch(() => [] as string[])
    const week = new Date(`${asOf}T00:00:00Z`)
    week.setUTCDate(week.getUTCDate() - 7)
    const since = week.toISOString().slice(0, 10)

    const recent: { name: string; size: number; sha256: string }[] = []
    for (const f of files) {
      if (!/^harel-\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(f) && !f.endsWith('.json.gz')) continue
      const date = f.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
      if (!date || date < since) continue
      const full = join(dir, f)
      const buf = await readFile(full)
      recent.push({ name: f, size: (await stat(full)).size, sha256: createHash('sha256').update(buf).digest('hex') })
    }

    const manifest = {
      week: `${since}..${asOf}`,
      generatedAt: new Date().toISOString(),
      files: recent,
      totalBytes: recent.reduce((a, f) => a + f.size, 0),
      note: 'שכבה 3 — עותק קר שבועי. שכבה 1 = גיבוי יומי, שכבה 2 = דוחות בדרייב.',
    }
    const manifestPath = join(dir, `cold-backup-${asOf}.json`)
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    let drive: string | null = null
    const google = await googleIntegration()
    if (hasScope(google, 'https://www.googleapis.com/auth/drive.file')) {
      try {
        const token = await googleAccessToken()
        const folder = await ensureFolderPath(token, reportFolder('backup', asOf.slice(0, 7)))
        for (const f of recent) {
          await uploadFile(token, folder, f.name, 'application/gzip', await readFile(join(dir, f.name)))
        }
        drive = (await uploadFile(token, folder, `cold-backup-${asOf}.json`, 'application/json',
          Buffer.from(JSON.stringify(manifest, null, 2)))).webViewLink
      } catch (e) { console.error('cold backup upload:', (e as Error).message) }
    }

    // §6 — "עותק מחוץ לשרת". בלי דרייב זה עדיין אותה מכונה, ואסור לשתוק על זה.
    const offsite = Boolean(drive)
    const s = await settingValues(['notify_email_dan'])
    const to = typeof s.notify_email_dan === 'string' ? s.notify_email_dan : null
    let queued = 0
    if (to) {
      queued = await enqueueOutbox([{
        channel: 'email', target: to,
        subject: `הר-אל · גיבוי שבועי ${asOf}${offsite ? '' : ' — מקומי בלבד'}`,
        body: `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif">
          <p>${recent.length} קבצי גיבוי מהשבוע (${Math.round(manifest.totalBytes / 1024)} KB).</p>
          <p>${offsite ? `עותק מחוץ לשרת: <a href="${drive}">בדרייב</a>` : '<b>אין עותק מחוץ לשרת</b> — גוגל לא מחובר, והגיבוי יושב על אותה מכונה שהוא מגבה.'}</p>
          <p>${recent.map((f) => `${f.name} — ${Math.round(f.size / 1024)} KB`).join('<br>') || 'לא נמצאו קבצי גיבוי מהשבוע — כדאי לבדוק את הג׳וב היומי.'}</p></div>`,
        dedupKey: `cold_backup:${asOf}`,
      }])
      await flushOutbox()
    }

    if (!recent.length || !offsite) {
      await withActor(async (tx) => {
        await tx`
          insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
          values (${!recent.length ? 'אין קבצי גיבוי מהשבוע' : 'הגיבוי יושב רק על השרת'},
                  ${asOf}, ${!recent.length ? 'high' : 'normal'}, true,
                  ${`cold_backup:${!recent.length ? 'missing' : 'local_only'}:${asOf}`},
                  ${!recent.length ? 'הג׳וב היומי db_backup לא הפיק קבצים' : 'לחבר את גוגל כדי שהעותק יעלה לדרייב (§6 שכבה 3)'})
          on conflict do nothing`
      })
    }

    return {
      rowsTouched: recent.length,
      detail: { files: recent.length, bytes: manifest.totalBytes, offsite, manifest: manifestPath, queued },
      ...(offsite ? {} : { skipped: 'עותק מקומי בלבד — גוגל לא מחובר' }),
    }
  })
}
