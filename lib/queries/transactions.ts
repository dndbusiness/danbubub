import { sql } from '@/lib/db'
import { monthRange } from '@/lib/rules/period.js'

/** תנועות — SPEC §5 מסך 5. */
export interface TxRow {
  id: string
  date_cash: string
  date_doc: string | null
  account_name: string
  amount_net: number
  vat_amount: number
  amount_gross: number
  vat_mode: string
  nature: string
  division: string
  category_id: string | null
  category_name: string | null
  tx_class: string
  deductible: boolean | null
  deal_id: string | null
  deal_client: string | null
  fixed_expense_id: string | null
  counterparty: string | null
  description: string | null
  invoice_status: string
  review_status: string
  parent_id: string | null
  locked: boolean
}

export async function listTransactions(opts: {
  month: string
  division: 'finance' | 'realestate' | 'all'
}): Promise<TxRow[]> {
  const { from, to } = monthRange(opts.month)
  const [y, m] = opts.month.split('-').map(Number)
  return sql<TxRow[]>`
    select
      t.id, to_char(t.date_cash,'YYYY-MM-DD') as date_cash, to_char(t.date_doc,'YYYY-MM-DD') as date_doc,
      a.name as account_name, t.amount_net, t.vat_amount, t.amount_gross, t.vat_mode,
      t.nature, t.division, t.category_id, c.name as category_name, t.tx_class, t.deductible,
      t.deal_id, d.client_name as deal_client, t.fixed_expense_id, t.counterparty, t.description,
      t.invoice_status, t.review_status, t.parent_id,
      exists (
        select 1 from periods p
        where p.status = 'closed' and p.deleted_at is null and p.year = ${y!} and p.month = ${m!}
          and (p.division::text = t.division::text or t.division = 'shared')
      ) as locked
    from transactions t
    join accounts a on a.id = t.account_id
    left join categories c on c.id = t.category_id
    left join deals d on d.id = t.deal_id
    where t.deleted_at is null
      and t.date_cash between ${from} and ${to}
      and (${opts.division} = 'all' or t.division::text = ${opts.division} or t.division = 'shared')
    order by t.date_cash desc, t.created_at desc`
}

/** סיכומי החודש לפס ה-KPI (SPEC §5.1) — מ-v_tx_classified, לא מחישוב ב-UI. */
export async function monthSummary(month: string, division: 'finance' | 'realestate' | 'all') {
  const rows = await sql<{ nature: string; amount: number; n: number }[]>`
    select nature::text, sum(amount_net) as amount, count(*)::int as n
    from v_tx_classified
    where month_cash = ${month}
      and (${division} = 'all' or division::text = ${division})
    group by nature`
  const get = (n: string) => rows.find((r) => r.nature === n)?.amount ?? 0
  const unknown = await sql<{ n: number }[]>`
    select count(*)::int as n from transactions
    where review_status = 'unknown_expense' and deleted_at is null and to_char(date_cash,'YYYY-MM') = ${month}`
  const missing = await sql<{ n: number; vat: number }[]>`
    select count(*)::int as n, coalesce(abs(sum(vat_amount)),0) as vat from transactions
    where nature = 'expense' and invoice_status in ('missing','unknown') and deleted_at is null
      and to_char(date_cash,'YYYY-MM') = ${month}`
  return {
    income: get('income'),
    expense: Math.abs(get('expense')),
    advance: Math.abs(get('advance')),
    draw: Math.abs(get('draw')),
    unknownCount: unknown[0]?.n ?? 0,
    missingInvoiceCount: missing[0]?.n ?? 0,
    missingInvoiceVat: missing[0]?.vat ?? 0,
  }
}
