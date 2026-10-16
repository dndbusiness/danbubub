import { describe, expect, it } from 'vitest'
import { computePayroll, proRataFactors, termsInEffect } from '@/lib/rules/payroll.js'
import { sumMoney } from '@/lib/rules/money.js'
import type { Employee, EmploymentTerms } from '@/lib/rules/types.js'

const hadas: Employee = {
  id: 'emp-hadas',
  name: 'הדס',
  payType: 'payslip',
  divisionSplit: { finance: 0.8, realestate: 0.2 },
  startDate: '2025-01-01',
  active: true,
}

const terms: EmploymentTerms = {
  id: 't1',
  employeeId: 'emp-hadas',
  validFrom: '2026-01-01',
  baseMode: 'hourly',
  hourlyRate: 60,
  components: [
    { name: 'בונוס פגישות', type: 'per_unit', rate: 150, unit: 'meetings' },
    { name: 'בונוס מכירות', type: 'pct_of_sales', rate: 0.02, salesBasis: 'collected' },
  ],
  employerCostPct: 0.22,
}

describe('תחשיב שכר — SPEC §3.9', () => {
  const result = computePayroll({
    employee: hadas,
    terms,
    inputs: {
      employeeId: 'emp-hadas',
      period: '2026-09',
      hoursWorked: 120,
      meetingsCount: 12,
      salesAmountNet: 150_000,
      manualAdjustments: [{ label: 'מקדמה', amount: -2_000, note: 'שולמה ב-10' }],
    },
  })

  it('בסיס = שעות × תעריף', () => {
    expect(result.base).toBe(7_200)
    expect(result.baseExplanation).toBe('120 שעות × 60.00 ₪ = 7,200.00 ₪')
  })

  it('רכיב per_unit עם ההסבר שנשלח לרו"ח', () => {
    const meetings = result.components[0]!
    expect(meetings.amount).toBe(1_800)
    expect(meetings.explanation).toBe('12 פגישות × 150.00 ₪ = 1,800.00 ₪')
  })

  it('רכיב pct_of_sales', () => {
    expect(result.components[1]!.amount).toBe(3_000)
  })

  it('ברוטו = בסיס + רכיבים ± התאמות', () => {
    expect(result.grossTotal).toBe(7_200 + 1_800 + 3_000 - 2_000)
  })

  it('עלות מעביד לתלוש = ברוטו × (1 + אחוז)', () => {
    expect(result.employerCostEst).toBe(12_200)
  })

  it('חלוקה לפעילויות מסתכמת לעלות המעביד בדיוק', () => {
    expect(sumMoney(Object.values(result.divisionAllocation))).toBe(result.employerCostEst)
    expect(result.divisionAllocation.finance).toBe(9_760)
    expect(result.divisionAllocation.realestate).toBe(2_440)
  })

  it('חשבונית/פרילנסר: אין עלות מעביד', () => {
    const freelancer = computePayroll({
      employee: { ...hadas, id: 'emp-f', payType: 'invoice' },
      terms,
      inputs: { employeeId: 'emp-f', period: '2026-09', hoursWorked: 100 },
    })
    expect(freelancer.grossTotal).toBe(6_000)
    expect(freelancer.employerCostEst).toBe(6_000)
  })
})

describe('סוגי רכיבים — SPEC §3.9', () => {
  const base: EmploymentTerms = {
    id: 't',
    employeeId: 'e',
    validFrom: '2026-01-01',
    baseMode: 'none',
    components: [],
    employerCostPct: 0,
  }
  const employee: Employee = { ...hadas, id: 'e', payType: 'invoice', divisionSplit: { finance: 1 } }

  it('tiered: מדרגות על הכמות', () => {
    const r = computePayroll({
      employee,
      terms: {
        ...base,
        components: [
          {
            name: 'מדרגות',
            type: 'tiered',
            unit: 'sales',
            tiers: [
              { from: 1, to: 5, rate: 200 },
              { from: 6, to: null, rate: 350 },
            ],
          },
        ],
      },
      inputs: { employeeId: 'e', period: '2026-09', salesCount: 8 },
    })
    // 5×200 + 3×350 = 2,050
    expect(r.components[0]!.amount).toBe(2_050)
    expect(r.components[0]!.explanation).toContain('5×200 + 3×350')
  })

  it('conditional_fixed: מתחת לסף → 0', () => {
    const component = {
      name: 'בונוס תנאי',
      type: 'conditional_fixed' as const,
      rate: 1_000,
      unit: 'meetings' as const,
      threshold: 10,
    }
    const below = computePayroll({
      employee,
      terms: { ...base, components: [component] },
      inputs: { employeeId: 'e', period: '2026-09', meetingsCount: 9 },
    })
    const above = computePayroll({
      employee,
      terms: { ...base, components: [component] },
      inputs: { employeeId: 'e', period: '2026-09', meetingsCount: 10 },
    })
    expect(below.components[0]!.amount).toBe(0)
    expect(below.components[0]!.explanation).toContain('לא זכאי')
    expect(above.components[0]!.amount).toBe(1_000)
  })

  it('תקרה חותכת את הרכיב ומסבירה למה', () => {
    const r = computePayroll({
      employee,
      terms: {
        ...base,
        components: [{ name: 'פגישות', type: 'per_unit', rate: 150, unit: 'meetings', cap: 1_500 }],
      },
      inputs: { employeeId: 'e', period: '2026-09', meetingsCount: 20 },
    })
    expect(r.components[0]!.amount).toBe(1_500)
    expect(r.components[0]!.capped).toBe(true)
    expect(r.components[0]!.explanation).toContain('תקרה')
  })

  it('בונוס קבוע', () => {
    const r = computePayroll({
      employee,
      terms: { ...base, components: [{ name: 'קבוע', type: 'fixed', rate: 500 }] },
      inputs: { employeeId: 'e', period: '2026-09' },
    })
    expect(r.components[0]!.amount).toBe(500)
  })
})

describe('שינוי הסכם באמצע חודש — SPEC §3.9', () => {
  const termsList: EmploymentTerms[] = [
    { ...terms, id: 'old', validFrom: '2026-01-01', validTo: '2026-09-14', hourlyRate: 60 },
    { ...terms, id: 'new', validFrom: '2026-09-15', hourlyRate: 70 },
  ]

  it('פרו-רטה לפי ימים, והחלקים מסתכמים ל-1', () => {
    const factors = proRataFactors('2026-09', termsList)
    expect(factors[0]!.days).toBe(14)
    expect(factors[1]!.days).toBe(16)
    expect(factors[0]!.factor + factors[1]!.factor).toBeCloseTo(1, 10)
  })

  it('שני חישובים פרו-רטה, שקופים בדוח', () => {
    const factors = proRataFactors('2026-09', termsList)
    const results = factors.map((f) =>
      computePayroll({
        employee: { ...hadas, payType: 'invoice' },
        terms: f.terms,
        inputs: { employeeId: 'emp-hadas', period: '2026-09', hoursWorked: 120 },
        proRataFactor: f.factor,
      }),
    )
    // 120×60×(14/30) + 120×70×(16/30) = 3,360 + 4,480 = 7,840
    expect(sumMoney(results.map((r) => r.base))).toBe(7_840)
  })

  it('ההסכם שבתוקף ב-1 לחודש הוא ברירת המחדל', () => {
    expect(termsInEffect('2026-09', termsList)?.id).toBe('old')
    expect(termsInEffect('2026-10', termsList)?.id).toBe('new')
  })
})
