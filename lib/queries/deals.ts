import { sql } from '@/lib/db'

/**
 * תיקים — SPEC §5 מסך 4.
 * החלטה 3 (ADDENDUM v2) + הבהרת דן: נדל"ן במערכת הוא כסף בלבד, לא תפעול.
 * לכן הפייפליין הוא **מימון בלבד**.
 */

export interface DealRow {
  deal_id: string
  client_name: string
  client_phone: string | null
  division: string
  product: string
  stage: string
  status: string
  collection_status: string
  fee_agreed_net: number
  collected_net: number
  open_balance_net: number
  direct_costs_net: number
  net_contribution: number
  open_committed: number
  open_expected_weighted: number
  month_attributed: string | null
  lead_source: string | null
  owner_name: string | null
  last_activity_at: string | null
  next_missing: string | null
}

export async function listFinanceDeals(): Promise<DealRow[]> {
  return sql<DealRow[]>`
    select
      b.deal_id, b.client_name, d.client_phone, b.division, d.product, d.stage, b.status,
      b.collection_status, b.fee_agreed_net, b.collected_net, b.open_balance_net,
      b.direct_costs_net, b.net_contribution, b.open_committed, b.open_expected_weighted,
      b.month_attributed,
      ls.name as lead_source, u.full_name as owner_name,
      to_char(d.last_activity_at, 'YYYY-MM-DD') as last_activity_at,
      ep.next_missing
    from v_deal_balance b
    join deals d on d.id = b.deal_id
    left join lead_sources ls on ls.id = d.lead_source_id
    left join users u on u.id = d.owner_user_id
    left join v_execution_pipeline ep on ep.deal_id = b.deal_id
    where b.division = 'finance'
    order by b.open_balance_net desc, d.created_at desc`
}

export interface DealPaymentRow {
  id: string; label: string; amount_net: number; expected_date: string
  certainty: 'committed' | 'expected'; probability: number; matched_tx_id: string | null
}
export interface DealTxRow {
  id: string; date_cash: string; amount_net: number; vat_amount: number; amount_gross: number
  nature: string; description: string | null; counterparty: string | null
  invoice_status: string; category_name: string | null
}
export interface DealChecklistRow {
  id: string; sort_order: number; label: string; status: string
  blocked_reason: string | null; status_since: string | null
}
export interface DealActivityRow {
  id: number; changed_at: string; action: string; table_name: string; actor: string | null; summary: string
}

export async function getDeal(id: string) {
  const [deal] = await sql<(DealRow & { notes: string | null; signed_at: string | null; expected_close_date: string | null })[]>`
    select b.*, d.client_phone, d.product, d.stage, d.notes,
      to_char(d.signed_at, 'YYYY-MM-DD') as signed_at,
      to_char(d.expected_close_date, 'YYYY-MM-DD') as expected_close_date,
      ls.name as lead_source, u.full_name as owner_name,
      to_char(d.last_activity_at, 'YYYY-MM-DD') as last_activity_at,
      ep.next_missing
    from v_deal_balance b
    join deals d on d.id = b.deal_id
    left join lead_sources ls on ls.id = d.lead_source_id
    left join users u on u.id = d.owner_user_id
    left join v_execution_pipeline ep on ep.deal_id = b.deal_id
    where b.deal_id = ${id}`
  if (!deal) return null

  const [payments, txs, checklist, activity] = await Promise.all([
    sql<DealPaymentRow[]>`
      select id, label, amount_net, to_char(expected_date,'YYYY-MM-DD') as expected_date,
             certainty, probability, matched_tx_id
      from deal_payments_plan where deal_id = ${id} and deleted_at is null
      order by expected_date`,
    sql<DealTxRow[]>`
      select t.id, to_char(t.date_cash,'YYYY-MM-DD') as date_cash, t.amount_net, t.vat_amount,
             t.amount_gross, t.nature, t.description, t.counterparty, t.invoice_status, c.name as category_name
      from transactions t left join categories c on c.id = t.category_id
      where t.deal_id = ${id} and t.deleted_at is null
      order by t.date_cash desc`,
    sql<DealChecklistRow[]>`
      select id, sort_order, label, status, blocked_reason, to_char(status_since,'YYYY-MM-DD') as status_since
      from deal_checklist_items where deal_id = ${id} and deleted_at is null order by sort_order`,
    // פיד פעילות אוטומטי (SPEC §5.1): כל שינוי בתיק ובתנועות שלו, מיומן השינויים.
    sql<DealActivityRow[]>`
      select a.id, to_char(a.changed_at,'YYYY-MM-DD HH24:MI') as changed_at, a.action, a.table_name,
             u.full_name as actor,
             coalesce(a.new_value->>'description', a.new_value->>'label', a.new_value->>'stage', '') as summary
      from audit_log a left join users u on u.id = a.changed_by
      where (a.table_name = 'deals' and a.row_id = ${id})
         or (a.table_name in ('transactions','deal_payments_plan','deal_checklist_items')
             and coalesce(a.new_value->>'deal_id', a.old_value->>'deal_id') = ${id})
      order by a.changed_at desc limit 50`,
  ])

  return { deal, payments, txs, checklist, activity }
}

// ── נדל"ן — כסף בלבד (הבהרת דן 18/09/2026) ────────────────────────────────
//
// "נדל"ן במערכת לא תפעול, רק כסף." עסקת נדל"ן היא נושא כסף: לקוח, סכום עסקה,
// 2% + מע"מ שכ"ט, ~1% כולל מע"מ עמלת יזם ב-שוטף+30, הוצאות ישירות, עמלת מכירה.
// סטטוס: פוטנציאל / סגור. בלי שלבים, בלי צ'קליסט.

/** נדל"ן: כל שלב מחתימת החוזה והלאה הוא "סגור" — כמו RE_CONTRACT_STAGES ב-forecast.ts. */
export const RE_CLOSED_STAGES = ['re_contract_signed', 're_fee_paid', 're_developer_commission_received', 're_closed'] as const
export const isRealEstateClosed = (stage: string) => (RE_CLOSED_STAGES as readonly string[]).includes(stage)

export interface RealEstateDealRow {
  deal_id: string
  client_name: string
  status: string
  /** פוטנציאל (re_lead) או סגור (חתימת חוזה ואילך). */
  stage: string
  closed: boolean
  /** סכום העסקה (מחיר הדירה). */
  base_amount: number | null
  fee_pct: number | null
  /** שכ"ט = base × fee_pct, ללא מע"מ. */
  fee_agreed_net: number
  opening_fee_net: number | null
  /** עמלת יזם — נטו (הוזנה "כולל מע"מ" ופורקה). */
  developer_commission_net: number | null
  collected_net: number
  open_balance_net: number
  direct_costs_net: number
  net_contribution: number
  signed_at: string | null
  expected_close_date: string | null
  month_attributed: string | null
  notes: string | null
}

export async function listRealEstateDeals(): Promise<RealEstateDealRow[]> {
  return sql<RealEstateDealRow[]>`
    select b.deal_id, b.client_name, b.status, d.stage,
           d.stage in ('re_contract_signed','re_fee_paid','re_developer_commission_received','re_closed') as closed,
           d.base_amount, d.fee_pct, b.fee_agreed_net,
           d.opening_fee_net, d.developer_commission_net, b.collected_net, b.open_balance_net,
           b.direct_costs_net, b.net_contribution,
           to_char(d.signed_at,'YYYY-MM-DD') as signed_at,
           to_char(d.expected_close_date,'YYYY-MM-DD') as expected_close_date,
           b.month_attributed, d.notes
    from v_deal_balance b
    join deals d on d.id = b.deal_id
    where b.division = 'realestate'
    order by closed asc, coalesce(d.signed_at, d.expected_close_date) desc nulls last`
}
