import { sql } from '@/lib/db'
import { computePayroll, proRataFactors, termsInEffect, type PayrollResult } from '@/lib/rules/payroll.js'
import type { Employee, EmploymentTerms, PayrollInputs } from '@/lib/rules/types.js'

/**
 * מסך 19 — שכר (SPEC §3.9).
 * החישוב עצמו ב-lib/rules/payroll.ts; כאן רק טעינה, הרכבה ותצוגה.
 * "כל מספר ב-computed נשמר עם ההסבר" — ההסבר מגיע מהפונקציה הטהורה, לא מה-UI.
 */

export interface EmployeeRow {
  id: string; name: string; national_id: string | null; pay_type: 'payslip' | 'invoice' | 'freelancer'
  division_split: Record<string, number>; start_date: string; end_date: string | null; active: boolean
}

export interface TermsRow {
  id: string; employee_id: string; valid_from: string; valid_to: string | null
  base_mode: 'hourly' | 'monthly' | 'none'; hourly_rate: number | null; monthly_base: number | null
  expected_hours: number | null; components: EmploymentTerms['components']; employer_cost_pct: number; notes: string | null
}

export interface PayrollMonthRow {
  id: string; employee_id: string; period: string
  hours_worked: number | null; meetings_count: number | null; sales_count: number | null
  leads_count: number | null; sales_amount_net: number | null
  manual_adjustments: { label: string; amount: number; note?: string }[]
  computed: PayrollResult | null; gross_total: number | null; employer_cost_est: number | null
  status: 'draft' | 'approved' | 'sent_to_accountant' | 'paid'
  approved_at: string | null; approved_by_name: string | null; paid_tx_id: string | null; report_file_url: string | null
}

export async function listEmployees(): Promise<EmployeeRow[]> {
  return sql<EmployeeRow[]>`
    select id, name, national_id, pay_type::text, division_split,
           to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date, active
    from employees where deleted_at is null order by active desc, name`
}

export async function listTerms(): Promise<TermsRow[]> {
  return sql<TermsRow[]>`
    select id, employee_id, to_char(valid_from, 'YYYY-MM-DD') as valid_from,
           to_char(valid_to, 'YYYY-MM-DD') as valid_to, base_mode, hourly_rate, monthly_base,
           expected_hours, components, employer_cost_pct, notes
    from employment_terms where deleted_at is null order by employee_id, valid_from desc`
}

export async function payrollMonths(period: string): Promise<PayrollMonthRow[]> {
  return sql<PayrollMonthRow[]>`
    select m.id, m.employee_id, m.period, m.hours_worked, m.meetings_count, m.sales_count, m.leads_count,
           m.sales_amount_net, m.manual_adjustments, m.computed, m.gross_total, m.employer_cost_est,
           m.status, m.approved_at::text, u.full_name as approved_by_name, m.paid_tx_id::text, m.report_file_url
    from payroll_months m left join users u on u.id = m.approved_by
    where m.period = ${period} and m.deleted_at is null`
}

const toEmployee = (e: EmployeeRow): Employee => ({
  id: e.id, name: e.name, payType: e.pay_type, divisionSplit: e.division_split,
  startDate: e.start_date, endDate: e.end_date ?? undefined, active: e.active,
})

const toTerms = (t: TermsRow): EmploymentTerms => ({
  id: t.id, employeeId: t.employee_id, validFrom: t.valid_from, validTo: t.valid_to ?? undefined,
  baseMode: t.base_mode,
  hourlyRate: t.hourly_rate === null ? undefined : Number(t.hourly_rate),
  monthlyBase: t.monthly_base === null ? undefined : Number(t.monthly_base),
  expectedHours: t.expected_hours === null ? undefined : Number(t.expected_hours),
  components: t.components ?? [],
  employerCostPct: Number(t.employer_cost_pct),
  notes: t.notes ?? undefined,
})

const toInputs = (m: PayrollMonthRow | undefined, employeeId: string, period: string): PayrollInputs => ({
  employeeId, period,
  hoursWorked: m?.hours_worked === null || m?.hours_worked === undefined ? undefined : Number(m.hours_worked),
  meetingsCount: m?.meetings_count ?? undefined,
  salesCount: m?.sales_count ?? undefined,
  leadsCount: m?.leads_count ?? undefined,
  salesAmountNet: m?.sales_amount_net === null || m?.sales_amount_net === undefined ? undefined : Number(m.sales_amount_net),
  manualAdjustments: m?.manual_adjustments ?? [],
})

export interface PayrollLine {
  employee: EmployeeRow
  month: PayrollMonthRow | null
  /** החישוב החי מההסכם שבתוקף. `null` כשאין הסכם לחודש הזה. */
  result: PayrollResult | null
  /** שני הסכמים בחודש אחד → פרו-רטה, וזה הפירוט (§3.9). */
  proRata: { termsId: string; days: number; factor: number }[]
  missingTerms: boolean
  /** קלט חסר שההסכם דורש — כדי שהמסך יגיד מה למלא ולא יציג 0 שקרי. */
  missingInputs: string[]
}

const UNIT_LABEL: Record<string, string> = { meetings: 'פגישות', sales: 'מכירות', hours: 'שעות', leads: 'לידים' }

/**
 * §3.9 — "לכל עובד, לכל חודש, לפי ההסכם שבתוקף בתאריך 1 לחודש".
 * חודש שאושר מוצג מהתצלום השמור (`computed`) ולא מחושב מחדש — אחרת אישור
 * לא היה אומר כלום.
 */
export async function payrollForMonth(period: string): Promise<PayrollLine[]> {
  const [employees, terms, months] = await Promise.all([listEmployees(), listTerms(), payrollMonths(period)])
  const byEmployee = new Map(months.map((m) => [m.employee_id, m]))

  return employees.map((e): PayrollLine => {
    const month = byEmployee.get(e.id) ?? null
    const mine = terms.filter((t) => t.employee_id === e.id).map(toTerms)
    const inMonth = proRataFactors(period, mine).filter((p) => p.days > 0)
    const active = termsInEffect(period, mine)

    if (month && month.status !== 'draft' && month.computed) {
      return {
        employee: e, month, result: month.computed as PayrollResult,
        proRata: inMonth.map((p) => ({ termsId: p.terms.id, days: p.days, factor: p.factor })),
        missingTerms: false, missingInputs: [],
      }
    }

    if (!inMonth.length || !active) {
      return { employee: e, month, result: null, proRata: [], missingTerms: true, missingInputs: [] }
    }

    const inputs = toInputs(month ?? undefined, e.id, period)
    const missingInputs: string[] = []
    for (const { terms: t } of inMonth) {
      if (t.baseMode === 'hourly' && inputs.hoursWorked === undefined) missingInputs.push('שעות')
      for (const c of t.components) {
        if (c.type === 'pct_of_sales' && inputs.salesAmountNet === undefined) missingInputs.push('סכום מכירות')
        if (c.unit && inputs[`${c.unit}Count` as 'meetingsCount'] === undefined) missingInputs.push(UNIT_LABEL[c.unit] ?? c.unit)
      }
    }

    // שני הסכמים באותו חודש — כל אחד מחושב לפי חלקו, והתוצאות מחוברות (§3.9).
    const parts = inMonth.map(({ terms: t, factor }) =>
      computePayroll({ employee: toEmployee(e), terms: t, inputs, proRataFactor: factor }))
    const result = parts.length === 1 ? parts[0]! : mergeParts(parts)

    return {
      employee: e, month, result,
      proRata: inMonth.map((p) => ({ termsId: p.terms.id, days: p.days, factor: p.factor })),
      missingTerms: false,
      missingInputs: [...new Set(missingInputs)],
    }
  })
}

/** חיבור שני חישובי פרו-רטה לשורה אחת, בלי לאבד את ההסברים. */
function mergeParts(parts: PayrollResult[]): PayrollResult {
  const first = parts[0]!
  const sum = (pick: (p: PayrollResult) => number) => Math.round(parts.reduce((a, p) => a + pick(p), 0) * 100) / 100
  const divisions = new Set(parts.flatMap((p) => Object.keys(p.divisionAllocation)))
  return {
    ...first,
    base: sum((p) => p.base),
    baseExplanation: parts.map((p) => `${p.baseExplanation} × ${Math.round(p.proRataFactor * 100)}%`).join(' + '),
    components: parts.flatMap((p) => p.components),
    adjustments: first.adjustments,
    adjustmentLines: first.adjustmentLines,
    grossTotal: sum((p) => p.grossTotal),
    employerCostEst: sum((p) => p.employerCostEst),
    divisionAllocation: Object.fromEntries(
      [...divisions].map((d) => [d, sum((p) => p.divisionAllocation[d as 'finance'] ?? 0)]),
    ),
    proRataFactor: 1,
  }
}

export interface PayrollTotals {
  gross: number; employerCost: number; byDivision: Record<string, number>
  employees: number; approved: number; paid: number; drafts: number
}

export function payrollTotals(lines: PayrollLine[]): PayrollTotals {
  const byDivision: Record<string, number> = {}
  let gross = 0, employerCost = 0
  for (const l of lines) {
    if (!l.result) continue
    gross += l.result.grossTotal
    employerCost += l.result.employerCostEst
    for (const [d, v] of Object.entries(l.result.divisionAllocation)) byDivision[d] = (byDivision[d] ?? 0) + (v ?? 0)
  }
  return {
    gross: Math.round(gross * 100) / 100,
    employerCost: Math.round(employerCost * 100) / 100,
    byDivision: Object.fromEntries(Object.entries(byDivision).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    employees: lines.filter((l) => l.result).length,
    approved: lines.filter((l) => l.month && l.month.status !== 'draft').length,
    paid: lines.filter((l) => l.month?.status === 'paid').length,
    drafts: lines.filter((l) => !l.month || l.month.status === 'draft').length,
  }
}

/** ההיסטוריה — לגרף ולהשוואה מול החודש הקודם. */
export async function payrollHistory(months = 12): Promise<{ period: string; gross: number; employer_cost: number; employees: number }[]> {
  return sql`
    select period, coalesce(sum(gross_total), 0) as gross, coalesce(sum(employer_cost_est), 0) as employer_cost,
           count(*)::int as employees
    from payroll_months where deleted_at is null and computed is not null
    group by period order by period desc limit ${months}`
}
