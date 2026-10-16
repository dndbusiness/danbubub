'use server'

import { revalidatePath } from 'next/cache'
import { sql, withActor } from '@/lib/db'
import { internalBaseUrl, renderPdf } from '@/lib/pdf'
import { buildGapsReport, renderGapsHtml } from '@/lib/reports/gaps'
import { settingValues } from '@/lib/queries/cashflow'
import { enqueueOutbox, flushOutbox } from '@/lib/jobs/outbox'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/**
 * §4.3 בדיקה 3 + קריטריון שלב 6 — "דוח פערים 12 חודשים אחורה מופק ונשלח לרו"ח".
 * הפקה ← PDF ← outbox (הנחיה 16) ← report_runs (כדי שצ'קליסט הסגירה של ב.7 יסמן ✓).
 */
export async function sendGapsReport(period?: string): Promise<Result<{ pdf: string | null; sent: boolean; queued: boolean; recipients: string[] }>> {
  try {
    const data = await buildGapsReport()
    const html = renderGapsHtml(data, process.env.APP_BASE_URL ?? internalBaseUrl())
    const month = period ?? new Date().toISOString().slice(0, 7)
    let pdf: string | null = null
    try { pdf = await renderPdf(`${internalBaseUrl()}/api/reports/gaps`, `gaps-${month}.pdf`) } catch (e) { console.error('gaps PDF failed:', (e as Error).message) }

    const s = await settingValues(['accountant_email', 'notify_email_dan'])
    const accountant = typeof s.accountant_email === 'string' ? s.accountant_email : null
    const dan = typeof s.notify_email_dan === 'string' ? s.notify_email_dan : null
    const to = [accountant, dan].filter((x): x is string => Boolean(x))
    let outboxId: string | null = null
    let queued = false
    if (to.length) {
      const dedupKey = `gaps:${month}:${new Date().toISOString().slice(0, 10)}`
      const n = await enqueueOutbox([{ channel: 'email', target: to.join(','), subject: `הר-אל · דוח פערי חשבוניות ${month}`, body: html, dedupKey }])
      if (n) {
        queued = true
        const [ob] = await sql<{ id: string }[]>`select id from outbox where dedup_key = ${dedupKey}`
        outboxId = ob?.id ?? null
        if (outboxId && pdf) await sql`update outbox set payload = ${sql.json({ pdfPath: pdf, fileName: `דוח-פערים-${month}.pdf` } as never)} where id = ${outboxId}`
      }
    }
    await withActor(async (tx) => {
      await tx`insert into report_runs (report_type, period, file_url, file_format, recipients, outbox_id)
               values ('invoice_gaps', ${month}, ${pdf}, 'pdf', ${to}, ${outboxId})`
    })
    const flush = queued ? await flushOutbox() : null
    revalidatePath('/gaps'); revalidatePath('/pnl'); revalidatePath('/settings')
    return { ok: true, pdf, queued, sent: Boolean(flush?.sent), recipients: to }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** §4.3 — סימון "לא נדרשת חשבונית" מהמסך (עמלות בנק, ביטוח לאומי, מס). */
export async function markNoInvoiceNeeded(txId: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update transactions set invoice_status = 'no_invoice_needed' where id = ${txId} and deleted_at is null`
    })
    revalidatePath('/gaps'); revalidatePath('/vat'); revalidatePath('/transactions')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** §4.3 — אישור שחשבונית מספק שהוא ישות שותף היא משיכה ולא הוצאה (שאלה #15). */
export async function resolvePartnerInvoice(invoiceId: string, decision: 'draw' | 'expense'): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update invoices set needs_partner_review = false where id = ${invoiceId} and deleted_at is null`
      await tx`update tasks set status = 'done' where auto_key = ${`partner_invoice:${invoiceId}`} and status <> 'done'`
      if (decision === 'draw') {
        const [inv] = await tx<{ matched_tx_id: string | null; partner_id: string | null }[]>`select matched_tx_id, partner_id from invoices where id = ${invoiceId}`
        if (inv?.matched_tx_id && inv.partner_id) {
          await tx`update transactions set nature = 'draw', partner_id = ${inv.partner_id}, category_id = null, deductible = null
                   where id = ${inv.matched_tx_id} and deleted_at is null`
        }
      }
    })
    revalidatePath('/gaps'); revalidatePath('/transactions')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
