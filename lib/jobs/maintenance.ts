import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { sql, withActor } from '@/lib/db'
import { stageProbability } from '@/lib/rules/probability'
import { ensureFolderPath, reportFolder, uploadFile } from '@/lib/google/drive'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { runJob } from './run'
import { enqueueOutbox, flushOutbox } from './outbox'
import { crmBackup, recordBackupRun } from '@/lib/crm/backup'
import { crmSettings, DEFAULT_LOGIN_EMAIL } from '@/lib/crm/auth'
import { storeFile } from '@/lib/files'
import { storageDir } from '@/lib/storage-dir'

/**
 * חלק ג' `deal_decay` (02:00 יומי) — SPEC §2.3: תיק בלי פעילות מאבד הסתברות
 * (30 יום → חצי, 60 יום → אפס), ונוצרת משימה לאחראי. הנוסחה ב-lib/rules/probability.ts.
 */
export async function dealDecayJob(asOf: string): Promise<{ rowsTouched: number; detail?: Record<string, unknown> }> {
  return runJob('deal_decay', async () => {
    const deals = await sql<{ id: string; client_name: string; stage: string; probability_override: number | null; last_activity_at: string | null; owner_user_id: string | null; open_balance: number }[]>`
      select d.id, d.client_name, d.stage, d.probability_override, to_char(d.last_activity_at, 'YYYY-MM-DD') as last_activity_at,
             d.owner_user_id, coalesce(b.open_balance_net, 0) as open_balance
      from deals d left join v_deal_balance b on b.deal_id = d.id
      where d.status = 'open' and d.deleted_at is null and d.last_activity_at is not null`
    let decayed = 0, tasks = 0
    await withActor(async (tx) => {
      for (const d of deals) {
        const r = stageProbability({ stage: d.stage as never, probabilityOverride: d.probability_override ?? undefined, lastActivityAt: d.last_activity_at ?? undefined }, asOf)
        if (r.decayFactor >= 1) continue
        decayed++
        // ההסתברות מחושבת בכל קריאה מ-lib/rules; מה שנשמר הוא רק התקבולים המשוקללים.
        const res = await tx`
          update deal_payments_plan set probability = ${r.probability}
          where deal_id = ${d.id} and certainty = 'expected' and matched_tx_id is null and deleted_at is null and probability <> ${r.probability}`
        if (res.count) {
          const days = r.daysStale ?? 0
          await tx`
            insert into tasks (title, due_date, priority, auto_generated, auto_key, deal_id, assignee_id, notes)
            values (${`תיק "${d.client_name}" ללא פעילות ${days} יום`}, ${asOf}, ${r.needsReviewTask ? 'high' : 'normal'}, true,
                    ${`deal_decay:${d.id}:${r.needsReviewTask ? 60 : 30}`}, ${d.id}, ${d.owner_user_id},
                    ${r.needsReviewTask ? 'ההסתברות אופסה — לעדכן סטטוס או לסגור' : 'ההסתברות נחתכה לחצי (§2.3)'})
            on conflict do nothing`
          tasks++
        }
      }
    })
    return { rowsTouched: decayed, detail: { checked: deals.length, decayed, tasks } }
  })
}

export const BACKUP_DIR = process.env.HAREL_BACKUP_DIR ?? storageDir('backups')

/**
 * חלק ג' `db_backup` (03:00 יומי) — SPEC §6 שכבה 2.
 * תמצית JSON דחוסה של הטבלאות העסקיות, לדרייב `גיבוי-DB/` (90 יום).
 * זה **לא** תחליף לגיבוי המלא של Supabase — זה עותק קריא שאפשר לשחזר ממנו ידנית.
 */
export async function dbBackupJob(asOf: string): Promise<{ rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }> {
  return runJob('db_backup', async () => {
    const TABLES = ['entities', 'accounts', 'partners', 'categories', 'suppliers', 'deals', 'deal_payments_plan', 'deal_checklist_items',
      'transactions', 'advances', 'partner_draws', 'fixed_expenses', 'invoices', 'balances', 'periods', 'employees', 'employment_terms',
      'payroll_months', 'leads', 'lead_costs', 'budgets', 'settings', 'collection_actions', 'daily_closes'] as const
    const dump: Record<string, unknown[]> = {}
    let rows = 0
    for (const t of TABLES) {
      const data = await sql.unsafe(`select * from ${t}`)
      dump[t] = data as unknown[]
      rows += data.length
    }
    const payload = gzipSync(Buffer.from(JSON.stringify({ takenAt: new Date().toISOString(), asOf, tables: dump }), 'utf8'))
    mkdirSync(BACKUP_DIR, { recursive: true })
    const fileName = `${asOf}.json.gz`
    const local = path.join(BACKUP_DIR, fileName)
    writeFileSync(local, payload)

    let driveUrl: string | null = null
    const google = await googleIntegration()
    if (hasScope(google, 'https://www.googleapis.com/auth/drive.file')) {
      try {
        const token = await googleAccessToken()
        const folder = await ensureFolderPath(token, reportFolder('backup', ''))
        driveUrl = (await uploadFile(token, folder, fileName, 'application/gzip', payload)).webViewLink
      } catch (e) { console.error('Drive backup failed:', (e as Error).message) }
    }
    await withActor(async (tx) => {
      await tx`insert into report_runs (report_type, period, file_url, file_format) values ('db_backup', ${asOf}, ${driveUrl ?? local}, 'csv')`
    })
    // נתוני ה-CRM (crm_docs) — קובץ נפרד, באותו מבנה כמו הגיבוי של הדף, כדי שישוחזר באותה דרך
    const crm = await crmBackupNightly(asOf).catch((e) => ({ ok: false, docs: 0, error: (e as Error).message }) as CrmNightly)
    return { rowsTouched: rows + crm.docs, skipped: driveUrl || crm.ok ? undefined : 'גוגל לא מחובר — הגיבוי נשמר מקומית בלבד',
      detail: { tables: TABLES.length, rows, sizeKb: Math.round(payload.length / 1024), drive: Boolean(driveUrl), crm } }
  })
}

type CrmNightly = { ok: boolean; docs: number; drive?: boolean; mail?: boolean; sizeKb?: number; error?: string }

/**
 * הגיבוי הלילי של ה-CRM: לדרייב (אם מחובר), ובמייל לכתובות הגיבוי (אם Gmail מחובר).
 * הקובץ מצורף למייל רק כשהדרייב לא הצליח — אחרת קישור בלבד, כדי לא לשמור עותק כל לילה במסד.
 * בלי גוגל — אין עותק מחוץ לשרת: הדף מציג "אין גיבוי תקין" ו"גבה עכשיו" מוריד את הקובץ למחשב.
 */
async function crmBackupNightly(asOf: string): Promise<CrmNightly> {
  const now = new Date()
  const b = await crmBackup(now, asOf)
  const sizeKb = Math.round(b.gz.length / 1024)
  const google = await googleIntegration()
  let viewUrl: string | null = null, driveErr: string | null = null
  if (hasScope(google, 'https://www.googleapis.com/auth/drive.file')) {
    try {
      const token = await googleAccessToken()
      viewUrl = (await uploadFile(token, await ensureFolderPath(token, reportFolder('backup', '')), b.name, 'application/gzip', b.gz)).webViewLink
    } catch (e) { driveErr = 'דרייב: ' + (e as Error).message }
  } else driveErr = 'גוגל דרייב לא מחובר'

  const settings = (await crmSettings()) as { backupEmails?: unknown; ownerEmail?: string }
  const mailTo = (Array.isArray(settings.backupEmails) ? settings.backupEmails.map(String) : [settings.ownerEmail ?? '', DEFAULT_LOGIN_EMAIL])
    .map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
  let mailOk = false, mailErr: string | null = null
  if (mailTo.length && hasScope(google, 'https://www.googleapis.com/auth/gmail.send')) {
    const dedupKey = `crm_backup:${asOf}`
    const body = `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif"><p>גיבוי מלא של ה-CRM מהשרת נכון ל-${asOf}: ${b.total} רשומות (${sizeKb} KB).</p>` +
      `<p>${viewUrl ? `הקובץ בדרייב: <a href="${viewUrl}">${b.name}</a>` : `הקובץ מצורף (${b.name}) — הדרייב לא זמין.`}</p>` +
      `<p style="color:#6B7280;font-size:12px">לשחזור: scripts/crm-mirror.mjs --force, או "ייבוא גיבוי" במערכת.</p></div>`
    if (await enqueueOutbox([{ channel: 'email', target: mailTo.join(','), subject: `[הר-אל] גיבוי CRM מהשרת — ${asOf}`, body, dedupKey }])) {
      if (!viewUrl) {
        const fileId = await storeFile(b.gz, b.name, 'application/gzip', 'backup')
        await sql`update outbox set payload = ${sql.json({ fileId, fileName: b.name } as never)} where dedup_key = ${dedupKey} and deleted_at is null`
      }
      await flushOutbox()
    }
    const [ob] = await sql<{ status: string; last_error: string | null }[]>`select status, last_error from outbox where dedup_key = ${dedupKey} and deleted_at is null`
    mailOk = ob?.status === 'sent'
    if (!mailOk) mailErr = 'מייל: ' + (ob?.last_error ?? ob?.status ?? 'לא נשלח')
  } else if (mailTo.length) mailErr = 'Gmail לא מחובר'

  const ok = Boolean(viewUrl) || mailOk
  const error = [driveErr, mailErr].filter(Boolean).join(' · ') || null
  await recordBackupRun({ day: asOf, at: now.toISOString(), ok, via: 'nightly', b, driveOk: Boolean(viewUrl), mailOk, mailTo, viewUrl, error })
  return { ok, docs: b.total, drive: Boolean(viewUrl), mail: mailOk, sizeKb, ...(error ? { error } : {}) }
}
