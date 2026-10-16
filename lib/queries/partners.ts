import { sql } from '@/lib/db'

/**
 * מסך 8 — משיכות שותפים נדל"ן (SPEC §3.5).
 * כל המספרים מ-v_partner_positions / v_investor_loan / v_cash_discount —
 * אין חישוב ב-UI (§11.20 והנחיית "כל דוח הוא view").
 */

export interface PartnerPositionRow {
  year: string
  partner_id: string
  name: string
  pay_method: 'invoice' | 'payslip'
  distributable_profit: number
  target: number
  drawn: number
  variance: number
  owner_loan_balance: number
  owner_loans: number
  loan_repayments: number
  draw_count: number
  investor_loan_opening: number
}

export async function partnerYears(): Promise<string[]> {
  const rows = await sql<{ year: string }[]>`select distinct year from v_partner_positions order by year desc`
  return rows.map((r) => r.year)
}

export async function partnerPositions(year: string): Promise<PartnerPositionRow[]> {
  return sql<PartnerPositionRow[]>`
    select year, partner_id, name, pay_method, distributable_profit, target, drawn, variance,
           owner_loan_balance, owner_loans, loan_repayments, draw_count, investor_loan_opening
    from v_partner_positions where year = ${year} order by name`
}

export interface RealEstateMonthRow { month: string; income: number; expenses: number; profit: number }

export async function realEstateMonths(year: string): Promise<RealEstateMonthRow[]> {
  return sql<RealEstateMonthRow[]>`
    select month, income, expenses, profit from v_realestate_profit
    where substring(month, 1, 4) = ${year} order by month`
}

export interface DrawRow {
  id: string
  date: string
  partner_id: string
  partner_name: string
  amount: number
  type: 'salary' | 'management_fee' | 'dividend' | 'loan_repayment' | 'owner_loan'
  includes_employer_cost: boolean
  note: string | null
  tx_id: string | null
}

export async function partnerDraws(year: string, partnerId?: string): Promise<DrawRow[]> {
  return sql<DrawRow[]>`
    select d.id, to_char(d.date, 'YYYY-MM-DD') as date, d.partner_id, p.name as partner_name,
           d.amount, d.type, d.includes_employer_cost, d.note, d.tx_id
    from partner_draws d join partners p on p.id = d.partner_id
    where d.deleted_at is null and to_char(d.date, 'YYYY') = ${year}
      and (${partnerId ?? null}::uuid is null or d.partner_id = ${partnerId ?? null})
    order by d.date desc, p.name`
}

export interface InvestorLoanRow {
  partner_id: string
  name: string
  opening_balance: number
  repaid: number
  balance: number
  average_monthly_repayment: number | null
  months_to_clear: number | null
  last_repayment: string | null
}

export async function investorLoans(): Promise<InvestorLoanRow[]> {
  return sql<InvestorLoanRow[]>`
    select partner_id, name, opening_balance, repaid, balance,
           average_monthly_repayment, months_to_clear, last_repayment::text
    from v_investor_loan order by balance desc`
}

export interface CashDiscountRow {
  tx_id: string; month: string; date: string; counterparty: string | null
  description: string | null; amount_net: number; amount_gross: number; division: string
}

/** §3.5 — נכיון מזומן מוצג בנפרד ולא מוסתר. */
export async function cashDiscountRows(year: string): Promise<CashDiscountRow[]> {
  return sql<CashDiscountRow[]>`
    select tx_id, month, to_char(date, 'YYYY-MM-DD') as date, counterparty, description,
           amount_net, amount_gross, division
    from v_cash_discount where substring(month, 1, 4) = ${year} order by date desc`
}

export async function realEstatePartners(): Promise<{ id: string; name: string; pay_method: string; investor_loan_opening: number; investor_loan_note: string | null }[]> {
  return sql`
    select id, name, pay_method, investor_loan_opening, investor_loan_note
    from partners where division = 'realestate' and active and deleted_at is null order by name`
}

export async function partnerById(id: string): Promise<{ id: string; name: string; pay_method: string } | null> {
  const [p] = await sql<{ id: string; name: string; pay_method: string }[]>`
    select id, name, pay_method from partners where id = ${id} and deleted_at is null`
  return p ?? null
}
