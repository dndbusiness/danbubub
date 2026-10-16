import { sql } from '@/lib/db'
import { findClosingBlockers, type ClosingBlocker } from '@/lib/rules/nissim-card.js'
import { monthRange } from '@/lib/rules/period.js'
import type { Advance, Deal, Transaction } from '@/lib/rules/types.js'

/**
 * כרטיס ניסים — SPEC §3.3, מסך 7.
 * המספרים מגיעים מ-v_nissim_card (מנוע אחד, §11.20); שורות ה-drill-down
 * והחריגים החוסמים — מאותן טבלאות. אין חישוב ב-UI.
 */

export interface NissimCardRow {
  month: string
  line1_collected_income: number
  line2_approved_fixed: number
  line3_direct: number
  line4_distributable_profit: number
  line5_nissim_share: number
  line5_harel_share: number
  line6_advances: number
  line7_closing_balance: number
  line8_transfer_due: number
  opening_amount: number
}

export interface PeriodInfo {
  id: string
  status: 'open' | 'closed'
  opening_balance: number | null
  closed_at: string | null
  closed_by_name: string | null
  snapshot_json: Record<string, unknown> | null
  settlement_transfer_tx_id: string | null
}

export async function nissimCardHistory(): Promise<NissimCardRow[]> {
  return sql<NissimCardRow[]>`select * from v_nissim_card order by month`
}

export async function nissimCardFor(month: string): Promise<NissimCardRow | null> {
  const rows = await sql<NissimCardRow[]>`select * from v_nissim_card where month = ${month}`
  return rows[0] ?? null
}

export async function periodFor(month: string, division: 'finance' | 'realestate' = 'finance'): Promise<PeriodInfo | null> {
  const [y, m] = month.split('-').map(Number)
  const rows = await sql<PeriodInfo[]>`
    select p.id, p.status, p.opening_balance, to_char(p.closed_at, 'DD/MM/YYYY HH24:MI') as closed_at,
           u.full_name as closed_by_name, p.snapshot_json, p.settlement_transfer_tx_id
    from periods p left join users u on u.id = p.closed_by
    where p.division = ${division} and p.year = ${y!} and p.month = ${m!} and p.deleted_at is null`
  return rows[0] ?? null
}

/** שורות ה-drill-down לכל אחת מ-8 השורות (SPEC §5 "חוק המסכים"). */
export interface DrillRow { id: string; date: string; label: string; counterparty: string | null; amount: number; flag: string | null }

export async function nissimDrill(month: string): Promise<Record<'income' | 'fixed' | 'direct' | 'advances', DrillRow[]>> {
  const [y, m] = month.split('-').map(Number)
  const income = await sql<DrillRow[]>`
    select c.tx_id as id, to_char(c.date_cash,'DD/MM/YYYY') as date,
           coalesce(c.description, 'שכ"ט') as label, coalesce(d.client_name, c.counterparty) as counterparty,
           c.amount_net as amount, nullif(c.review_status::text, 'ok') as flag
    from v_tx_classified c left join deals d on d.id = c.deal_id
    where c.division = 'finance' and c.nature = 'income' and c.deal_id is not null and c.month_cash = ${month}
    order by c.date_cash`
  const fixed = await sql<DrillRow[]>`
    select c.tx_id as id, to_char(c.date_cash,'DD/MM/YYYY') as date,
           coalesce(cat.name, c.description, '') as label, c.counterparty, c.amount_net as amount,
           nullif(c.review_status::text, 'ok') as flag
    from v_tx_classified c
    left join categories cat on cat.id = c.category_id
    left join fixed_expenses f on f.id = c.fixed_expense_id
    where c.division = 'finance' and c.nature = 'expense' and c.deal_id is null and c.deductible is true
      and c.month_cash = ${month}
      and (c.fixed_expense_id is null or f.approved_by_nissim is true)
    order by c.date_cash`
  const direct = await sql<DrillRow[]>`
    select c.tx_id as id, to_char(c.date_cash,'DD/MM/YYYY') as date,
           coalesce(c.description, 'הוצאה ישירה') as label, d.client_name as counterparty, c.amount_net as amount,
           nullif(c.review_status::text, 'ok') as flag
    from v_tx_classified c
    join v_deal_month dm on dm.deal_id = c.deal_id
    join deals d on d.id = c.deal_id
    where c.division = 'finance' and c.nature = 'expense' and c.deductible is true and dm.month_attributed = ${month}
    order by c.date_cash`
  const advances = await sql<DrillRow[]>`
    select a.id, to_char(a.date,'DD/MM/YYYY') as date, coalesce(a.note, a.method::text) as label,
           'ניסים' as counterparty, -a.amount_gross as amount, null::text as flag
    from advances a where a.period = ${month} and a.deleted_at is null order by a.date`
  void y; void m
  return { income, fixed, direct, advances }
}

/** חריגים שחוסמים סגירה — SPEC §3.3 שלב 2, דרך הפונקציה הטהורה. */
export async function closingBlockers(month: string): Promise<ClosingBlocker[]> {
  const { from, to } = monthRange(month)
  const txs = await sql<Transaction[]>`
    select id, to_char(date_cash,'YYYY-MM-DD') as "dateCash", account_id as "accountId", amount_net as "amountNet",
           vat_mode as "vatMode", vat_rate as "vatRate", vat_amount as "vatAmount", amount_gross as "amountGross",
           nature, division, category_id as "categoryId", tx_class as "txClass", deductible, fixed_expense_id as "fixedExpenseId",
           deal_id as "dealId", certainty, parent_id as "parentId", invoice_status as "invoiceStatus", review_status as "reviewStatus"
    from transactions where deleted_at is null and division in ('finance','shared') and date_cash between ${from} and ${to}`
  const deals = await sql<Deal[]>`
    select id, client_name as "clientName", division, product, stage, collection_status as "collectionStatus",
           fee_agreed_net as "feeAgreedNet", fee_mode as "feeMode", month_attributed as "monthAttributed", status
    from deals where deleted_at is null and division = 'finance'`
  const advances = await sql<Advance[]>`
    select id, to_char(date,'YYYY-MM-DD') as date, amount_gross as "amountGross", method, period from advances where deleted_at is null`
  // תיקים בלי חודש עם כסף: הפונקציה בודקת לפי כל התנועות של התיק, לא רק החודש
  const allDealTxs = await sql<Transaction[]>`
    select id, to_char(date_cash,'YYYY-MM-DD') as "dateCash", account_id as "accountId", amount_net as "amountNet",
           vat_mode as "vatMode", vat_rate as "vatRate", vat_amount as "vatAmount", amount_gross as "amountGross",
           nature, division, category_id as "categoryId", tx_class as "txClass", deductible, fixed_expense_id as "fixedExpenseId",
           deal_id as "dealId", certainty, parent_id as "parentId", invoice_status as "invoiceStatus", review_status as "reviewStatus"
    from transactions where deleted_at is null and deal_id is not null`
  const merged = new Map<string, Transaction>()
  for (const t of [...txs, ...allDealTxs]) merged.set(t.id, t)
  return findClosingBlockers([...merged.values()], { month, deals, advances })
}

/** תנועות "לשאול את ניסים" בחודש — לא חוסמות סגירה, אבל מוצגות (שאלה #23). */
export async function askNissimCount(month: string): Promise<{ n: number; amount: number }> {
  const rows = await sql<{ n: number; amount: number }[]>`
    select count(*)::int as n, coalesce(sum(amount_net), 0) as amount from transactions
    where review_status = 'ask_nissim' and deleted_at is null and to_char(date_cash, 'YYYY-MM') = ${month}`
  return rows[0] ?? { n: 0, amount: 0 }
}
