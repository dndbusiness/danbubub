import { readFile } from 'node:fs/promises'
import { sql, withActor } from '@/lib/db'
import { internalBaseUrl, renderPdf } from '@/lib/pdf'
import { buildWeeklyReport, renderWeeklyHtml, type Audience } from '@/lib/reports/weekly'
import { refreshMonthClose } from '@/lib/queries/month-close'
import { settingValues } from '@/lib/queries/cashflow'
import { ensureFolderPath, reportFolder, uploadFile } from '@/lib/google/drive'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { addMonths, monthOf, weekStart } from '@/lib/rules/period'
import { enqueueOutbox, flushOutbox } from './outbox'
import { runJob } from './run'

type Out = { rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }

async function toDrive(kind: Parameters<typeof reportFolder>[0], period: string, fileName: string, pdf: string | null): Promise<string | null> {
  if (!pdf) return null
  const google = await googleIntegration()
  if (!hasScope(google, 'https://www.googleapis.com/auth/drive.file')) return null
  try {
    const token = await googleAccessToken()
    const folder = await ensureFolderPath(token, reportFolder(kind, period))
    return (await uploadFile(token, folder, fileName, 'application/pdf', await readFile(pdf))).webViewLink
  } catch (e) { console.error('Drive upload failed:', (e as Error).message); return null }
}

async function record(type: string, period: string, fileUrl: string | null, recipients: string[], outboxId: string | null) {
  await withActor(async (tx) => {
    await tx`insert into report_runs (report_type, period, file_url, file_format, recipients, outbox_id)
             values (${type}, ${period}, ${fileUrl}, 'pdf', ${recipients}, ${outboxId})`
  })
}

/**
 * חלק ג' `weekly_report` (ו' 08:00) — ADDENDUM ב.7.
 * שלוש גרסאות לפי הרשאה (החלטה 21): דן הכול · ניסים מימון בלי יתרת בנק · אביב נדל"ן.
 */
export async function weeklyReportJob(asOf: string): Promise<Out & { recipients: number }> {
  return runJob('weekly_report', async () => {
    const s = await settingValues(['notify_email_dan', 'notify_email_nissim', 'notify_email_aviv'])
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
    const targets: { audience: Audience; email: string | null }[] = [
      { audience: 'dan', email: str(s.notify_email_dan) },
      { audience: 'nissim', email: str(s.notify_email_nissim) },
      { audience: 'aviv', email: str(s.notify_email_aviv) },
    ]
    const week = weekStart(asOf)
    const base = process.env.APP_BASE_URL ?? internalBaseUrl()
    let queued = 0
    const detail: Record<string, unknown> = {}

    for (const t of targets) {
      const data = await buildWeeklyReport(asOf, t.audience)
      const html = renderWeeklyHtml(data, base)
      const fileName = `weekly-${week}-${t.audience}.pdf`
      let pdf: string | null = null
      try { pdf = await renderPdf(`${internalBaseUrl()}/reports/weekly/${week}?audience=${t.audience}`, fileName) } catch (e) { detail[`pdf_${t.audience}`] = (e as Error).message }
      const driveUrl = t.audience === 'dan' ? await toDrive('weekly', week, `שבוע-${week}.pdf`, pdf) : null
      let outboxId: string | null = null
      if (t.email) {
        const dedupKey = `weekly:${week}:${t.audience}`
        const n = await enqueueOutbox([{ channel: 'email', target: t.email, subject: `הר-אל · דוח שבועי ${week}`, body: html, dedupKey }])
        if (n) {
          queued += n
          const [ob] = await sql<{ id: string }[]>`select id from outbox where dedup_key = ${dedupKey}`
          outboxId = ob?.id ?? null
          if (outboxId && pdf) await sql`update outbox set payload = ${sql.json({ pdfPath: pdf, fileName: `דוח-שבועי-${week}.pdf` })} where id = ${outboxId}`
        }
      }
      await record('weekly', week, driveUrl ?? pdf, t.email ? [t.email] : [], outboxId)
      detail[t.audience] = t.email ? (outboxId ? 'queued' : 'already sent') : 'no target'
    }
    const flush = queued ? await flushOutbox() : null
    return { rowsTouched: queued, detail: { ...detail, flush }, recipients: targets.filter((t) => t.email).length }
  })
}

/**
 * חלק ג' `pnl_draft` (1 לחודש) ו-`pnl_final` (12 לחודש, אם הצ'קליסט מלא) — ADDENDUM ב.7.
 * אותו מנוע של מסך 2 (הנחיה 20) — ה-PDF מופק מ-/pnl/print.
 */
export async function pnlReportJob(asOf: string, kind: 'draft' | 'final'): Promise<Out & { month: string; ready?: boolean }> {
  return runJob(kind === 'draft' ? 'pnl_draft' : 'pnl_final', async () => {
    const month = addMonths(monthOf(asOf), -1)
    const status = await refreshMonthClose(month)
    if (kind === 'final' && !status.ready) {
      // ב.7 — "משימה: צ'קליסט לא הושלם".
      await withActor(async (tx) => {
        await tx`insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
                 values (${`צ'קליסט סגירת ${month} לרו"ח לא הושלם`}, ${asOf}, 'high', true, ${`month_close_incomplete:${month}`},
                         ${status.blockers.map((b) => `${b.label}: ${b.detail}`).join(' · ')})
                 on conflict do nothing`
      })
      return { rowsTouched: 0, skipped: `הצ'קליסט לא הושלם: ${status.blockers.map((b) => b.label).join(', ')}`, month, ready: false }
    }

    const files: { division: string; pdf: string | null; drive: string | null }[] = []
    for (const division of ['finance', 'realestate'] as const) {
      let pdf: string | null = null
      try { pdf = await renderPdf(`${internalBaseUrl()}/pnl/print?period=${month}&division=${division}&mode=distributable`, `pnl-${kind}-${division}-${month}.pdf`) } catch (e) { void e }
      files.push({ division, pdf, drive: await toDrive('pnl', month, `${month}-${division}${kind === 'draft' ? '-טיוטה' : ''}.pdf`, pdf) })
    }

    // מייל: טיוטה לדן; סופי — לדן ולרו"ח (ב.7).
    const s = await settingValues(['notify_email_dan', 'accountant_email'])
    const to = [typeof s.notify_email_dan === 'string' ? s.notify_email_dan : null, kind === 'final' && typeof s.accountant_email === 'string' ? s.accountant_email : null].filter((x): x is string => Boolean(x))
    let outboxId: string | null = null
    if (to.length) {
      const dedupKey = `pnl_${kind}:${month}`
      const body = `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif"><p>מצורף דוח רווח והפסד ${kind === 'draft' ? '(טיוטה — החודש עדיין פתוח)' : 'סופי'} לחודש ${month}.</p>
        <p>${status.items.map((i) => `${i.done ? '✓' : '✗'} ${i.label}`).join('<br>')}</p></div>`
      const n = await enqueueOutbox([{ channel: 'email', target: to.join(','), subject: `הר-אל · רווח והפסד ${month}${kind === 'draft' ? ' (טיוטה)' : ''}`, body, dedupKey }])
      if (n) {
        const [ob] = await sql<{ id: string }[]>`select id from outbox where dedup_key = ${dedupKey}`
        outboxId = ob?.id ?? null
        const main = files.find((f) => f.pdf)?.pdf
        if (outboxId && main) await sql`update outbox set payload = ${sql.json({ pdfPath: main, fileName: `רווח-והפסד-${month}.pdf` })} where id = ${outboxId}`
      }
    }
    await record(kind === 'draft' ? 'pnl_draft' : 'pnl_final', month, files[0]?.drive ?? files[0]?.pdf ?? null, to, outboxId)
    const flush = outboxId ? await flushOutbox() : null
    return { rowsTouched: files.filter((f) => f.pdf).length, detail: { files: files.map((f) => ({ division: f.division, drive: Boolean(f.drive) })), checklist: `${status.done}/${status.total}`, flush }, month, ready: status.ready }
  })
}

/** חלק ג' `accountant_pack` (12 לחודש) — מייל אחד לרו"ח עם הכול. */
export async function accountantPackJob(asOf: string): Promise<Out & { month: string }> {
  return runJob('accountant_pack', async () => {
    const month = addMonths(monthOf(asOf), -1)
    const s = await settingValues(['accountant_email', 'notify_email_dan'])
    const accountant = typeof s.accountant_email === 'string' ? s.accountant_email : null
    if (!accountant) return { rowsTouched: 0, skipped: 'לא הוגדר מייל לרו"ח (settings.accountant_email)', month }
    const status = await refreshMonthClose(month)
    const runs = await sql<{ report_type: string; file_url: string | null; created_at: string }[]>`
      select report_type, file_url, created_at::text from report_runs
      where period = ${month} and deleted_at is null and report_type in ('pnl_final', 'payroll', 'invoice_gaps', 'nissim_settlement')
      order by created_at desc`
    const body = `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;font-size:14px">
      <p>שלום, מצורף חומר הסגירה לחודש ${month}.</p>
      <p><b>מה מצורף:</b><br>${runs.length ? runs.map((r) => `• ${({ pnl_final: 'רווח והפסד', payroll: 'דוח שכר', invoice_gaps: 'דוח פערים', nissim_settlement: 'התחשבנות' })[r.report_type] ?? r.report_type}${r.file_url?.startsWith('http') ? ` — <a href="${r.file_url}">קישור</a>` : ''}`).join('<br>') : 'טרם הופקו דוחות לחודש זה.'}</p>
      <p><b>צ'קליסט הסגירה:</b><br>${status.items.map((i) => `${i.done ? '✓' : '✗'} ${i.label} — ${i.detail}`).join('<br>')}</p>
      <p style="color:#6B7280;font-size:12px">הופק אוטומטית ממערכת הכספים של הר-אל.</p></div>`
    const dedupKey = `accountant_pack:${month}`
    const n = await enqueueOutbox([{ channel: 'email', target: accountant, subject: `הר-אל · חומר סגירה ${month}`, body, dedupKey }])
    let outboxId: string | null = null
    if (n) { const [ob] = await sql<{ id: string }[]>`select id from outbox where dedup_key = ${dedupKey}`; outboxId = ob?.id ?? null }
    await record('accountant_pack', month, null, [accountant], outboxId)
    const flush = n ? await flushOutbox() : null
    return { rowsTouched: n, detail: { attachments: runs.length, checklist: `${status.done}/${status.total}`, ready: status.ready, flush }, month }
  })
}
