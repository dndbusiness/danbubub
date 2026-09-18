import { readFile } from 'node:fs/promises'
import { sql, withActor } from '@/lib/db'
import { internalBaseUrl, renderPdf } from '@/lib/pdf'
import { buildDailySummary, renderDailySummaryHtml } from '@/lib/reports/daily-summary'
import { ensureFolderPath, reportFolder, uploadFile } from '@/lib/google/drive'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { settingValues } from '@/lib/queries/cashflow'
import { enqueueOutbox, flushOutbox } from './outbox'
import { runJob } from './run'

export interface DailySummaryOutcome { rowsTouched: number; skipped?: string; detail?: Record<string, unknown>; pdf: string | null; driveUrl: string | null; emailed: boolean }

/**
 * חלק ג' `daily_summary` (07:30 א'–ו') — ADDENDUM ב.4: מייל HTML RTL לדן + PDF זהה בדרייב `סיכום-יומי/`.
 * אותה פונקציה מפיקה את הדוח מהמסך (הנחיה 20). לא מופק בשבת.
 */
export async function dailySummaryJob(date: string, opts: { force?: boolean } = {}): Promise<DailySummaryOutcome> {
  return runJob('daily_summary', async () => {
    const data = await buildDailySummary(date)
    if (data.isSaturday && !opts.force) return { rowsTouched: 0, skipped: 'שבת — אין סיכום יומי (ב.4)', pdf: null, driveUrl: null, emailed: false }
    const base = process.env.APP_BASE_URL ?? internalBaseUrl()
    const html = renderDailySummaryHtml(data, base)
    const fileName = `daily-${date}.pdf`

    let pdf: string | null = null
    try { pdf = await renderPdf(`${internalBaseUrl()}/reports/daily/${date}`, fileName) } catch (e) { console.error('daily PDF failed:', (e as Error).message) }

    // דרייב — רק אם גוגל מחובר עם drive.file
    let driveUrl: string | null = null
    const google = await googleIntegration()
    if (pdf && hasScope(google, 'https://www.googleapis.com/auth/drive.file')) {
      try {
        const token = await googleAccessToken()
        const folder = await ensureFolderPath(token, reportFolder('daily', date))
        driveUrl = (await uploadFile(token, folder, `${date}.pdf`, 'application/pdf', await readFile(pdf))).webViewLink
      } catch (e) { console.error('Drive upload failed:', (e as Error).message) }
    }

    // מייל לדן בלבד (החלטה 21) דרך outbox (הנחיה 16); dedup ליום.
    const s = await settingValues(['notify_email_dan'])
    const email = typeof s.notify_email_dan === 'string' ? s.notify_email_dan : null
    let queued = 0
    let outboxId: string | null = null
    if (email) {
      queued = await enqueueOutbox([{ channel: 'email', target: email, subject: `הר-אל · סיכום יומי ${date.slice(8, 10)}/${date.slice(5, 7)}`, body: html, dedupKey: `daily_summary:${date}` }])
      const [row] = await sql<{ id: string }[]>`select id from outbox where dedup_key = ${`daily_summary:${date}`} and deleted_at is null`
      outboxId = row?.id ?? null
      if (queued && outboxId && pdf) await sql`update outbox set payload = ${sql.json({ pdfPath: pdf, fileName: `סיכום-יומי-${date}.pdf` })} where id = ${outboxId}`
    }
    await withActor(async (tx) => {
      await tx`
        insert into report_runs (report_type, period, file_url, file_format, recipients, outbox_id)
        values ('daily_summary', ${date}, ${driveUrl ?? pdf}, 'pdf', ${email ? [email] : []}, ${outboxId})`
    })
    const flush = queued ? await flushOutbox() : null
    return { rowsTouched: 1, detail: { items: data.itemsCount, quiet: data.itemsCount === 0, drive: Boolean(driveUrl), email: email ? (flush?.sent ? 'sent' : 'queued') : 'no target', flush }, pdf, driveUrl, emailed: Boolean(flush?.sent) }
  })
}
