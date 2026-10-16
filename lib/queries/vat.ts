import { sql } from '@/lib/db'

export interface VatPeriodRow {
  period: string; first_month: string; last_month: string
  output_vat: number; input_vat_claimable: number; input_vat_missing_invoice: number
  missing_invoice_count: number; liability: number; bimonthly: boolean
}

/** מסך 10 — חבות מע"מ לפי תקופת דיווח (§3.1). */
export async function vatPeriods(limit = 18): Promise<VatPeriodRow[]> {
  return sql<VatPeriodRow[]>`
    select period, first_month, last_month, output_vat, input_vat_claimable, input_vat_missing_invoice,
           missing_invoice_count::int, liability, bimonthly
    from v_vat_periods limit ${limit}`
}

export interface VatLine { id: string; date: string; counterparty: string | null; description: string | null; amount_gross: number; vat_amount: number; invoice_status: string; category_name: string | null }

/** ה-drill של כל מספר במסך 10 — §11.7: אין מספר בלי השורות שמרכיבות אותו. */
export async function vatLines(period: string, kind: 'output' | 'input_claimable' | 'input_missing'): Promise<VatLine[]> {
  const months = period.includes('/') ? [`${period.slice(0, 5)}${period.slice(5, 7)}`, `${period.slice(0, 5)}${period.slice(8, 10)}`] : [period]
  return sql<VatLine[]>`
    select t.tx_id as id, to_char(coalesce(t.date_doc, t.date_cash), 'YYYY-MM-DD') as date, t.counterparty, t.description,
           t.amount_gross, t.vat_amount, t.invoice_status, c.name as category_name
    from v_tx_classified t left join categories c on c.id = t.category_id
    where t.certainty = 'actual' and to_char(coalesce(t.date_doc, t.date_cash), 'YYYY-MM') = any(${months})
      and ${kind === 'output' ? sql`t.nature = 'income'` : kind === 'input_claimable' ? sql`t.nature = 'expense' and t.invoice_status = 'has_invoice'` : sql`t.nature = 'expense' and t.invoice_status in ('missing','unknown')`}
    order by abs(t.vat_amount) desc`
}

/** התשלום הבא: 15 לחודש על התקופה שנסגרה (§3.1 + לוח החיובים). */
export async function nextVatPayment(today: string): Promise<{ date: string; period: string; amount: number } | null> {
  const rows = await vatPeriods(2)
  const prev = rows.find((r) => r.last_month < today.slice(0, 7))
  if (!prev) return null
  const day = 15
  const month = today.slice(8, 10) <= String(day).padStart(2, '0') ? today.slice(0, 7) : (() => { const [y, m] = today.slice(0, 7).split('-').map(Number); return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}` })()
  return { date: `${month}-${String(day).padStart(2, '0')}`, period: prev.period, amount: prev.liability }
}
