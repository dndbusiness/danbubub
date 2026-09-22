import { sql } from '@/lib/db'

/**
 * רווח והפסד — SPEC §3.2, מסך 2. שתי הגדרות, בכוונה.
 * הסכומים מ-v_pnl; הפירוק לקטגוריות מ-v_tx_classified — מנוע אחד (§11.20).
 */

export type PnlMode = 'operational' | 'distributable'
export type PnlDivision = 'finance' | 'realestate'

export interface PnlTotals {
  mode: PnlMode
  division: PnlDivision
  month: string
  income: number
  fixed_expenses: number
  direct_expenses: number
  total_expenses: number
  profit: number
}

export interface PnlLine { key: string; label: string; amount: number; count: number }

export async function pnlTotals(month: string, division: PnlDivision, mode: PnlMode): Promise<PnlTotals> {
  const rows = await sql<PnlTotals[]>`
    select mode, division, month, coalesce(income,0) as income, coalesce(fixed_expenses,0) as fixed_expenses,
           coalesce(direct_expenses,0) as direct_expenses, coalesce(total_expenses,0) as total_expenses, coalesce(profit,0) as profit
    from v_pnl where month = ${month} and division = ${division} and mode = ${mode}`
  return rows[0] ?? { mode, division, month, income: 0, fixed_expenses: 0, direct_expenses: 0, total_expenses: 0, profit: 0 }
}

/** פירוק ההוצאות לקטגוריות + drill (מזהי תנועות) — לפי ההגדרה. */
export async function pnlExpenseLines(month: string, division: PnlDivision, mode: PnlMode): Promise<(PnlLine & { txIds: string[] })[]> {
  if (mode === 'operational') {
    return sql<(PnlLine & { txIds: string[] })[]>`
      select coalesce(c.category_id::text, 'none') as key, coalesce(cat.name, 'ללא קטגוריה') as label,
             abs(sum(c.amount_net)) as amount, count(*)::int as count, array_agg(c.tx_id::text) as "txIds"
      from v_tx_classified c left join categories cat on cat.id = c.category_id
      where c.certainty = 'actual' and c.nature = 'expense' and c.division = ${division} and c.month_cash = ${month}
      group by 1, 2 order by amount desc`
  }
  // לחלוקה: מוכרות (ובמימון מאושרות), ישירות לפי חודש התיק
  return sql<(PnlLine & { txIds: string[] })[]>`
    with fixed as (
      select c.tx_id, c.category_id, c.amount_net
      from v_tx_classified c left join fixed_expenses f on f.id = c.fixed_expense_id
      where c.certainty = 'actual' and c.nature = 'expense' and c.division = ${division} and c.month_cash = ${month}
        and c.deal_id is null and c.deductible is true
        and (c.fixed_expense_id is null or ${division} = 'realestate' or f.approved_by_nissim is true)
    ), direct as (
      select c.tx_id, c.category_id, c.amount_net
      from v_tx_classified c join v_deal_month dm on dm.deal_id = c.deal_id
      where c.certainty = 'actual' and c.nature = 'expense' and c.division = ${division}
        and c.deductible is true and dm.month_attributed = ${month}
    ), all_rows as (select * from fixed union all select * from direct)
    select coalesce(a.category_id::text, 'none') as key, coalesce(cat.name, 'ללא קטגוריה') as label,
           abs(sum(a.amount_net)) as amount, count(*)::int as count, array_agg(a.tx_id::text) as "txIds"
    from all_rows a left join categories cat on cat.id = a.category_id
    group by 1, 2 order by amount desc`
}

export async function pnlIncomeLines(month: string, division: PnlDivision, mode: PnlMode): Promise<(PnlLine & { txIds: string[] })[]> {
  return sql<(PnlLine & { txIds: string[] })[]>`
    select coalesce(c.deal_id::text, 'none') as key, coalesce(d.client_name, c.counterparty, 'ללא תיק') as label,
           sum(c.amount_net) as amount, count(*)::int as count, array_agg(c.tx_id::text) as "txIds"
    from v_tx_classified c left join deals d on d.id = c.deal_id
    where c.certainty = 'actual' and c.nature = 'income' and c.division = ${division} and c.month_cash = ${month}
      and (${mode} = 'operational' or c.deal_id is not null)
    group by 1, 2 order by amount desc`
}

/** רווח לפי חודש, שתי ההגדרות — לגרף "רווח לחלוקה לפי חודש" (UIUX §5.1). */
export async function pnlByMonth(division: PnlDivision): Promise<{ month: string; operational: number; distributable: number }[]> {
  return sql<{ month: string; operational: number; distributable: number }[]>`
    select month,
           coalesce(max(profit) filter (where mode = 'operational'), 0) as operational,
           coalesce(max(profit) filter (where mode = 'distributable'), 0) as distributable
    from v_pnl where division = ${division} group by month order by month`
}

/** תנועות לפי מזהים — ל-drill מהמסך. */
export async function txByIds(ids: string[]) {
  if (!ids.length) return []
  return sql<{ id: string; date: string; label: string; counterparty: string | null; amount: number }[]>`
    select t.id, to_char(t.date_cash,'DD/MM/YYYY') as date, coalesce(t.description, c.name, '') as label,
           t.counterparty, t.amount_net as amount
    from transactions t left join categories c on c.id = t.category_id
    where t.id = any(${ids}::uuid[]) order by t.date_cash`
}
