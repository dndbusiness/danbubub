import { sql } from '@/lib/db'
import { addMonths, dayInMonth } from '@/lib/rules/period.js'

/**
 * הוצאות קבועות — SPEC §5 מסך 6 + ADDENDUM ב.9 "כרטיס הוצאה קבועה":
 * לכל הוצאה שורת חודשים: צפוי / בפועל / ✓ שודך / ✗ לא ירד / ⚠ סכום שונה.
 */
export interface FixedExpenseRow {
  id: string
  name: string
  category_name: string
  division: string
  division_split: Record<string, number> | null
  amount_net: number
  vat_mode: string
  frequency: string
  day_of_month: number
  account_name: string
  variable: boolean
  approved_by_nissim: boolean
  start_date: string
  end_date: string | null
  active: boolean
}

export type MonthStatus = 'matched' | 'missing' | 'deviation' | 'future' | 'not_due'

export interface FixedExpenseMonth {
  month: string
  expectedDate: string
  expected: number
  actual: number | null
  txId: string | null
  status: MonthStatus
}

export async function listFixedExpenses(): Promise<FixedExpenseRow[]> {
  return sql<FixedExpenseRow[]>`
    select f.id, f.name, c.name as category_name, f.division, f.division_split, f.amount_net,
           f.vat_mode, f.frequency, f.day_of_month, a.name as account_name, f.variable,
           f.approved_by_nissim, to_char(f.start_date,'YYYY-MM-DD') as start_date,
           to_char(f.end_date,'YYYY-MM-DD') as end_date, f.active
    from fixed_expenses f
    join categories c on c.id = f.category_id
    join accounts a on a.id = f.account_id
    where f.deleted_at is null
    order by f.active desc, f.day_of_month, f.name`
}

/** 12 חודשים אחורה מהחודש הנבחר, לכל הוצאה: מה קרה בפועל. */
export async function fixedExpenseMonths(
  expenses: FixedExpenseRow[],
  asOfMonth: string,
  today: string,
  months = 12,
): Promise<Map<string, FixedExpenseMonth[]>> {
  const from = addMonths(asOfMonth, -(months - 1))
  const actuals = await sql<{ fixed_expense_id: string; month: string; amount: number; tx_id: string }[]>`
    select fixed_expense_id, to_char(date_cash,'YYYY-MM') as month, sum(amount_net) as amount, min(id::text) as tx_id
    from transactions
    where fixed_expense_id is not null and deleted_at is null and nature = 'expense'
      and to_char(date_cash,'YYYY-MM') between ${from} and ${asOfMonth}
    group by fixed_expense_id, to_char(date_cash,'YYYY-MM')`

  const byKey = new Map(actuals.map((a) => [`${a.fixed_expense_id}|${a.month}`, a]))
  const out = new Map<string, FixedExpenseMonth[]>()

  for (const f of expenses) {
    const list: FixedExpenseMonth[] = []
    for (let i = months - 1; i >= 0; i--) {
      const month = addMonths(asOfMonth, -i)
      const expectedDate = dayInMonth(month, f.day_of_month)
      const inRange = expectedDate >= f.start_date && (!f.end_date || expectedDate <= f.end_date)
      const due = inRange && (f.frequency === 'monthly' || occurs(f, month))
      const a = byKey.get(`${f.id}|${month}`)
      const actual = a ? Math.abs(a.amount) : null
      const expected = Math.abs(f.amount_net)
      let status: MonthStatus
      if (!due) status = 'not_due'
      else if (actual === null) status = expectedDate > today ? 'future' : 'missing'
      else if (expected > 0 && Math.abs(actual - expected) / expected > 0.2) status = 'deviation'
      else status = 'matched'
      list.push({ month, expectedDate, expected, actual, txId: a?.tx_id ?? null, status })
    }
    out.set(f.id, list)
  }
  return out
}

function occurs(f: FixedExpenseRow, month: string): boolean {
  const start = f.start_date.slice(0, 7)
  const [sy, sm] = start.split('-').map(Number)
  const [y, m] = month.split('-').map(Number)
  const delta = (y! - sy!) * 12 + (m! - sm!)
  if (f.frequency === 'quarterly') return delta % 3 === 0
  if (f.frequency === 'yearly') return delta % 12 === 0
  if (f.frequency === 'once') return delta === 0
  return true
}
