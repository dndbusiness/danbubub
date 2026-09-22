import { sql } from '@/lib/db'
import type { Extracted } from '@/lib/intake/extract'
import { INVOICE_MATCH, matchTarget, type MatchCandidate } from '@/lib/match/invoices'

export interface CandidateRow {
  id: string; source: string; source_ref: string; received_at: string; sender: string | null; subject: string | null; file_name: string | null
  file_url: string | null; local_path: string | null; extracted: (Extracted & { verified?: unknown }) | null; extraction_method: string | null
  kind: string; verified: boolean; status: string; failure_reason: string | null; invoice_id: string | null; matched_tx_id: string | null
  doc_text: string | null; import_batch_id: string | null
}

export async function listCandidates(status: 'pending' | 'all' = 'pending'): Promise<CandidateRow[]> {
  return sql<CandidateRow[]>`
    select id, source, source_ref, received_at::text, sender, subject, file_name, file_url, local_path, extracted, extraction_method, kind, verified, status,
           failure_reason, invoice_id, matched_tx_id, left(doc_text, 1500) as doc_text, import_batch_id
    from inbox_candidates where deleted_at is null and (${status === 'all'} or status = 'pending')
    order by status = 'pending' desc, received_at desc limit 200`
}

export interface TxOption { id: string; date_cash: string; amount_gross: number; counterparty: string | null; description: string | null; invoice_status: string; invoice_id: string | null }

/** מועמדי שידוך לחשבונית (ב.3 שלב 5) — לפי ההצעה שחולצה. */
export async function matchOptions(extracted: Extracted | null): Promise<{ options: TxOption[]; suggested: MatchCandidate[] }> {
  const date = extracted?.date ?? new Date().toISOString().slice(0, 10)
  const options = await sql<TxOption[]>`
    select id, to_char(date_cash, 'YYYY-MM-DD') as date_cash, amount_gross, counterparty, description, invoice_status, invoice_id from transactions
    where nature = 'expense' and deleted_at is null and certainty = 'actual' and parent_id is null or (nature = 'expense' and deleted_at is null and parent_id is not null)
    order by abs(date_cash - ${date}::date), abs(amount_gross) limit 60`
  const inWindow = options.filter((o) => Math.abs((Date.parse(o.date_cash) - Date.parse(date)) / 86_400_000) <= 45)
  const suggested = extracted?.gross
    ? matchTarget({ amountGross: extracted.gross, date, supplierName: extracted.supplierName }, inWindow.map((o) => ({ id: o.id, dateCash: o.date_cash, amountGross: o.amount_gross, counterparty: o.counterparty, description: o.description, invoiceId: o.invoice_id })), INVOICE_MATCH).candidates
    : []
  return { options: inWindow, suggested }
}

export async function supplierOptions(): Promise<{ id: string; name: string }[]> {
  return sql<{ id: string; name: string }[]>`select id, name from suppliers where deleted_at is null order by name`
}

export async function intakeCounts(): Promise<{ pending: number; statements: number }> {
  const [r] = await sql<{ pending: number; statements: number }[]>`
    select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'pending' and kind = 'statement')::int as statements
    from inbox_candidates where deleted_at is null`
  return r ?? { pending: 0, statements: 0 }
}
