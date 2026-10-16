import { sql } from '@/lib/db'

export interface GapMonthRow {
  month: string
  income_without_invoice: number; income_without_invoice_amount: number
  invoice_without_receipt: number; invoice_without_receipt_amount: number
  expense_without_invoice: number; expense_without_invoice_amount: number
  vat_at_risk: number; total_gaps: number
}

/** מסך 12 / §4.3 בדיקה 3 — 12 חודשים אחורה. */
export async function gapsByMonth(): Promise<GapMonthRow[]> {
  return sql<GapMonthRow[]>`
    select month, income_without_invoice::int, income_without_invoice_amount, invoice_without_receipt::int,
           invoice_without_receipt_amount, expense_without_invoice::int, expense_without_invoice_amount,
           vat_at_risk, total_gaps::int
    from v_invoice_gaps_by_month`
}

export interface GapRow { gap_kind: string; ref_id: string; date: string; amount: number; vat_at_risk: number; counterparty: string | null; description: string | null }

export async function gapLines(kind?: string, month?: string): Promise<GapRow[]> {
  return sql<GapRow[]>`
    select gap_kind, ref_id::text, to_char(date, 'YYYY-MM-DD') as date, amount, vat_at_risk, counterparty, description
    from v_invoice_gaps
    where (${kind ?? null}::text is null or gap_kind = ${kind ?? null})
      and (${month ?? null}::text is null or to_char(date, 'YYYY-MM') = ${month ?? null})
      and date >= date_trunc('month', current_date) - interval '11 months'
    order by date desc limit 500`
}

/** §4.3 — חשבוניות של ישויות השותפים שממתינות לאישור (משיכה ולא הוצאה). */
export async function partnerInvoicesPending() {
  return sql<{ id: string; date: string; counterparty: string | null; amount_gross: number; doc_number: string | null; partner_name: string | null }[]>`
    select i.id, to_char(i.date, 'YYYY-MM-DD') as date, i.counterparty, i.amount_gross, i.doc_number, p.name as partner_name
    from invoices i left join partners p on p.id = i.partner_id
    where i.needs_partner_review and i.deleted_at is null order by i.date desc`
}

export async function greenInvoiceSummary() {
  const [r] = await sql<{ total: number; reported: number; open: number; unmatched: number; last_import: string | null }[]>`
    select count(*)::int as total,
           count(*) filter (where reported)::int as reported,
           count(*) filter (where not reported)::int as open,
           count(*) filter (where matched_tx_id is null)::int as unmatched,
           (select max(created_at)::text from import_batches where source = 'greeninvoice_import' and deleted_at is null) as last_import
    from invoices where source = 'greeninvoice_import' and deleted_at is null`
  return r ?? { total: 0, reported: 0, open: 0, unmatched: 0, last_import: null }
}

export interface ReportRunRow { period: string | null; created_at: string; sent_at: string | null; recipients: string[]; file_url: string | null }

/** ADDENDUM ב.9 — "מה נשלח לרו"ח ומתי". */
export async function lastReportRun(reportType: string): Promise<ReportRunRow | null> {
  const [r] = await sql<ReportRunRow[]>`
    select period, created_at::text, sent_at::text, recipients, file_url
    from report_runs where report_type = ${reportType} and deleted_at is null
    order by created_at desc limit 1`
  return r ?? null
}
