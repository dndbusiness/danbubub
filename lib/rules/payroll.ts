/**
 * תחשיב שכר חודשי — SPEC §3.9.
 *
 *   בסיס       = hourly_rate × hours_worked | monthly_base | 0
 *   לכל רכיב:
 *     per_unit           → rate × כמות (עד cap)
 *     pct_of_sales       → rate × sales_amount_net
 *     fixed              → rate
 *     tiered             → Σ לפי מדרגות על הכמות
 *     conditional_fixed  → rate אם כמות ≥ סף, אחרת 0
 *   ברוטו      = בסיס + Σ רכיבים ± manual_adjustments
 *   עלות_מעביד = ברוטו × (1 + employer_cost_pct)   [תלוש]
 *              = ברוטו                              [חשבונית / פרילנסר]
 *   חלוקה      = עלות_מעביד × division_split
 *
 * SPEC §3.9: "כל מספר ב-computed נשמר עם ההסבר ('12 פגישות × 150 ₪ = 1,800 ₪')".
 * ההסבר איננו קישוט — הוא מה שמופיע בדוח לרו"ח ומה שהעובד רואה, ולכן הוא
 * מוחזר מהפונקציה ולא מורכב מחדש ב-UI.
 */

import {
  addMoney,
  allocateMoney,
  mulMoney,
  round2,
  sumBy,
  formatShekels,
  type Shekels,
} from './money.js'
import { daysBetween, monthRange, type IsoMonth } from './period.js'
import type {
  ConcreteDivision,
  Employee,
  EmploymentTerms,
  PayComponent,
  PayrollInputs,
} from './types.js'

export interface ComputedComponent {
  name: string
  type: PayComponent['type']
  quantity: number | null
  rate: number | null
  amount: Shekels
  /** ההסבר המילולי — "12 פגישות × 150 ₪ = 1,800 ₪". */
  explanation: string
  /** הופעלה תקרה או רצפה. */
  capped?: boolean
}

export interface PayrollResult {
  employeeId: string
  period: IsoMonth
  payType: Employee['payType']
  base: Shekels
  baseExplanation: string
  components: ComputedComponent[]
  adjustments: Shekels
  adjustmentLines: Array<{ label: string; amount: Shekels; note?: string }>
  /** ברוטו לתלוש, או סכום החשבונית לפני מע"מ. */
  grossTotal: Shekels
  /** ברוטו × (1 + employer_cost_pct) — לתלוש בלבד. */
  employerCostEst: Shekels
  /** חלוקת עלות המעביד לפעילויות, בלי לאבד אגורה. */
  divisionAllocation: Partial<Record<ConcreteDivision, Shekels>>
  /** פרו-רטה: כשההסכם השתנה באמצע החודש. */
  proRataFactor: number
}

export interface PayrollOptions {
  employee: Employee
  terms: EmploymentTerms
  inputs: PayrollInputs
  /** SPEC §3.9 — "שינוי הסכם באמצע חודש → שני חישובים פרו-רטה לפי ימים". */
  proRataFactor?: number
}

export function computePayroll(opts: PayrollOptions): PayrollResult {
  const { employee, terms, inputs, proRataFactor = 1 } = opts

  // ── בסיס ─────────────────────────────────────────────────────────────────
  let base: Shekels = 0
  let baseExplanation = 'ללא בסיס (עמלות בלבד)'

  if (terms.baseMode === 'hourly') {
    const hours = inputs.hoursWorked ?? 0
    const rate = terms.hourlyRate ?? 0
    base = mulMoney(round2(rate), hours)
    baseExplanation = `${hours} שעות × ${formatShekels(rate)} = ${formatShekels(base)}`
  } else if (terms.baseMode === 'monthly') {
    base = round2(terms.monthlyBase ?? 0)
    baseExplanation = `בסיס חודשי ${formatShekels(base)}`
  }
  base = mulMoney(base, proRataFactor)

  // ── רכיבים ───────────────────────────────────────────────────────────────
  const components = terms.components.map((component) =>
    computeComponent(component, inputs, proRataFactor),
  )

  // ── התאמות ידניות ────────────────────────────────────────────────────────
  const adjustmentLines = inputs.manualAdjustments ?? []
  const adjustments = sumBy(adjustmentLines, (a) => a.amount)

  const grossTotal = addMoney(base, sumBy(components, (c) => c.amount), adjustments)

  // ── עלות מעביד ───────────────────────────────────────────────────────────
  // SPEC §3.9: תלוש → ברוטו × (1 + pct). חשבונית/פרילנסר → ברוטו (המע"מ נפרד).
  const employerCostEst =
    employee.payType === 'payslip' ? mulMoney(grossTotal, 1 + terms.employerCostPct) : grossTotal

  // ── חלוקה לפעילויות ──────────────────────────────────────────────────────
  const divisions = (Object.keys(employee.divisionSplit) as ConcreteDivision[]).filter(
    (d) => (employee.divisionSplit[d] ?? 0) > 0,
  )
  const weights = divisions.map((d) => employee.divisionSplit[d] ?? 0)
  const allocated = allocateMoney(employerCostEst, weights)
  const divisionAllocation: Partial<Record<ConcreteDivision, Shekels>> = {}
  divisions.forEach((d, i) => {
    divisionAllocation[d] = allocated[i] ?? 0
  })

  return {
    employeeId: employee.id,
    period: inputs.period,
    payType: employee.payType,
    base,
    baseExplanation,
    components,
    adjustments,
    adjustmentLines,
    grossTotal,
    employerCostEst,
    divisionAllocation,
    proRataFactor,
  }
}

function computeComponent(
  component: PayComponent,
  inputs: PayrollInputs,
  proRata: number,
): ComputedComponent {
  const quantity = quantityFor(component, inputs)
  const rate = component.rate ?? 0
  let amount: Shekels = 0
  let explanation = ''

  switch (component.type) {
    case 'per_unit': {
      amount = mulMoney(round2(rate), quantity ?? 0)
      explanation = `${quantity ?? 0} ${unitLabel(component.unit)} × ${formatShekels(rate)} = ${formatShekels(amount)}`
      break
    }
    case 'pct_of_sales': {
      const sales = inputs.salesAmountNet ?? 0
      amount = mulMoney(sales, rate)
      explanation = `${formatShekels(sales)} × ${(rate * 100).toFixed(2)}% = ${formatShekels(amount)}`
      break
    }
    case 'fixed': {
      amount = round2(rate)
      explanation = `בונוס קבוע ${formatShekels(amount)}`
      break
    }
    case 'tiered': {
      const qty = quantity ?? 0
      const { total, detail } = computeTiers(qty, component.tiers ?? [])
      amount = total
      explanation = `${qty} ${unitLabel(component.unit)}: ${detail} = ${formatShekels(total)}`
      break
    }
    case 'conditional_fixed': {
      const qty = quantity ?? 0
      const threshold = component.threshold ?? 0
      const met = qty >= threshold
      amount = met ? round2(rate) : 0
      explanation = met
        ? `${qty} ≥ ${threshold} ${unitLabel(component.unit)} → ${formatShekels(amount)}`
        : `${qty} < ${threshold} ${unitLabel(component.unit)} → לא זכאי`
      break
    }
  }

  amount = mulMoney(amount, proRata)

  let capped = false
  if (component.cap !== undefined && amount > component.cap) {
    amount = round2(component.cap)
    explanation += ` (תקרה ${formatShekels(component.cap)})`
    capped = true
  }
  if (component.floor !== undefined && amount < component.floor) {
    amount = round2(component.floor)
    explanation += ` (רצפה ${formatShekels(component.floor)})`
    capped = true
  }

  return {
    name: component.name,
    type: component.type,
    quantity,
    rate: component.rate ?? null,
    amount,
    explanation,
    ...(capped ? { capped } : {}),
  }
}

function computeTiers(
  quantity: number,
  tiers: NonNullable<PayComponent['tiers']>,
): { total: Shekels; detail: string } {
  const parts: string[] = []
  let total = 0
  for (const tier of tiers) {
    const upper = tier.to ?? Infinity
    if (quantity < tier.from) continue
    const unitsInTier = Math.min(quantity, upper) - tier.from + 1
    if (unitsInTier <= 0) continue
    const sub = round2(unitsInTier * tier.rate)
    total = addMoney(total, sub)
    parts.push(`${unitsInTier}×${tier.rate}`)
  }
  return { total: round2(total), detail: parts.join(' + ') || '0' }
}

function quantityFor(component: PayComponent, inputs: PayrollInputs): number | null {
  switch (component.unit) {
    case 'meetings':
      return inputs.meetingsCount ?? 0
    case 'sales':
      return inputs.salesCount ?? 0
    case 'hours':
      return inputs.hoursWorked ?? 0
    case 'leads':
      return inputs.leadsCount ?? 0
    default:
      return null
  }
}

function unitLabel(unit: PayComponent['unit']): string {
  switch (unit) {
    case 'meetings':
      return 'פגישות'
    case 'sales':
      return 'מכירות'
    case 'hours':
      return 'שעות'
    case 'leads':
      return 'לידים'
    default:
      return 'יחידות'
  }
}

/**
 * פרו-רטה לפי ימים כשההסכם השתנה באמצע החודש — SPEC §3.9.
 * מחזיר את חלקו של כל הסכם בחודש, שסכומם 1.
 */
export function proRataFactors(
  month: IsoMonth,
  termsList: readonly EmploymentTerms[],
): Array<{ terms: EmploymentTerms; factor: number; days: number }> {
  const { from, to } = monthRange(month)
  const totalDays = daysBetween(from, to) + 1

  return termsList.map((terms) => {
    const start = terms.validFrom > from ? terms.validFrom : from
    const end = terms.validTo && terms.validTo < to ? terms.validTo : to
    const days = start > end ? 0 : daysBetween(start, end) + 1
    return { terms, factor: days / totalDays, days }
  })
}

/** ההסכם שבתוקף בתאריך 1 לחודש — ברירת המחדל של §3.9. */
export function termsInEffect(
  month: IsoMonth,
  termsList: readonly EmploymentTerms[],
): EmploymentTerms | undefined {
  const { from } = monthRange(month)
  return termsList.find((t) => t.validFrom <= from && (!t.validTo || t.validTo >= from))
}
