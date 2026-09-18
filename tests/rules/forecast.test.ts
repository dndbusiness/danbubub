import { describe, expect, it } from 'vitest'
import {
  computeFinanceForecast,
  computeFinanceRates,
  computeForecastAccuracy,
  computeRealEstateForecast,
  computeUnifiedForecast,
  measureLagDistribution,
  newBusinessFactor,
  OPTIMISTIC_FACTOR,
  sharedExpenseDoubleCount,
  type ForecastSnapshot,
} from '@/lib/rules/forecast.js'
import { sumMoney } from '@/lib/rules/money.js'
import type {
  Deal,
  DealPaymentPlan,
  DealStage,
  FixedExpense,
  Transaction,
} from '@/lib/rules/types.js'

const ASOF = '2026-09-18'

function deal(over: Partial<Deal> & { id: string }): Deal {
  return {
    clientName: over.id,
    division: 'finance',
    product: 'business_credit',
    stage: 'submitted' as DealStage,
    collectionStatus: 'not_collected',
    feeAgreedNet: 0,
    feeMode: 'fixed',
    status: 'open',
    ...over,
  }
}

function income(id: string, amount: number, date: string, dealId: string): Transaction {
  return {
    id, dateCash: date, accountId: 'acc', amountNet: amount, vatMode: 'excl', vatRate: 0.18,
    vatAmount: amount * 0.18, amountGross: amount * 1.18, nature: 'income', division: 'finance',
    txClass: 'business', certainty: 'actual', invoiceStatus: 'has_invoice', dealId,
  }
}

function fixed(over: Partial<FixedExpense> & { id: string; amountNet: number }): FixedExpense {
  return {
    name: over.id, categoryId: 'c', division: 'finance', vatMode: 'excl',
    frequency: 'monthly', dayOfMonth: 1, accountId: 'acc', variable: false,
    approvedByNissim: true, startDate: '2026-01-01', active: true,
    ...over,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// §3.7.1 — נדל"ן
// ════════════════════════════════════════════════════════════════════════════

describe('תחזית נדל"ן — SPEC §3.7.1', () => {
  // 3 חוזים ב-12 שבועות → 3/12×4.345 ≈ 1.086 עסקאות לחודש
  const reDeals: Deal[] = [
    deal({ id: 're1', division: 'realestate', product: 'presale', stage: 're_contract_signed', feeAgreedNet: 40_000, openingFeeNet: 5_000, developerCommissionNet: 20_000, signedAt: '2026-07-10' }),
    deal({ id: 're2', division: 'realestate', product: 'presale', stage: 're_closed', feeAgreedNet: 60_000, openingFeeNet: 5_000, developerCommissionNet: 30_000, signedAt: '2026-08-05' }),
    deal({ id: 're3', division: 'realestate', product: 'presale', stage: 're_fee_paid', feeAgreedNet: 50_000, openingFeeNet: 5_000, developerCommissionNet: 25_000, signedAt: '2026-09-01' }),
  ]

  const reFixed = [fixed({ id: 'fx-re', amountNet: 20_000, division: 'realestate' })]

  const forecast = computeRealEstateForecast([], {
    asOf: ASOF,
    deals: reDeals,
    plans: [],
    fixedExpenses: reFixed,
    withholdingTaxPct: 0.1,
    monthlyDraws: 30_000,
    monthlyLoanRepayment: 10_000,
  })

  const at = (month: string, scenario: string) =>
    forecast.find((f) => f.month === month && f.scenario === scenario)!

  it('קצב עסקאות = ממוצע נע 12 שבועות', () => {
    const a = at('2026-10', 'base').assumptions.find((x) => x.key === 're.dealsPerMonth')!
    expect(a.value).toBeCloseTo((3 / 12) * 4.345, 2)
    expect(a.sampleSize).toBe(3)
  })

  it('ערך עסקה: מיידי ועמלת יזם נמדדים בנפרד — תזמון שונה', () => {
    const as = at('2026-10', 'base').assumptions
    // (40+5 + 60+5 + 50+5) / 3 = 55,000
    expect(as.find((x) => x.key === 're.immediatePerDeal')!.value).toBe(55_000)
    // (20 + 30 + 25) / 3 = 25,000
    expect(as.find((x) => x.key === 're.developerPerDeal')!.value).toBe(25_000)
  })

  it('הכנסה מיידית נספרת בחודש החתימה', () => {
    const base = at('2026-10', 'base')
    expect(base.immediateIncome).toBeCloseTo(55_000 * base.expectedDeals, 0)
  })

  it('עמלת יזם מגיעה net-30 — בחודש +1, אחרי ניכוי במקור', () => {
    const oct = at('2026-10', 'base')
    const nov = at('2026-11', 'base')
    // אוקטובר הוא החודש הראשון בתחזית: אין לפניו עסקאות חדשות
    expect(oct.developerCommissions).toBe(0)
    // נובמבר מקבל את העמלות מעסקאות אוקטובר, בניכוי 10%
    expect(nov.developerCommissions).toBeCloseTo(25_000 * nov.expectedDeals * 0.9, 0)
  })

  it('רווח לחלוקה מתחלק לשלושה בלי לאבד אגורה', () => {
    const base = at('2026-11', 'base')
    expect(base.partnerShares).toHaveLength(3)
    expect(sumMoney(base.partnerShares)).toBe(base.distributableProfit)
  })

  it('תזרים נטו מנכה גם את המשיכות ואת החזר חוב יוני', () => {
    const base = at('2026-10', 'base')
    expect(base.draws).toBe(40_000)
    expect(base.netCashFlow).toBeCloseTo(
      base.totalIncome - base.expenses - 40_000, 2,
    )
  })

  it('פסימי = אפס עסקאות חדשות', () => {
    const p = at('2026-10', 'pessimistic')
    expect(p.expectedDeals).toBe(0)
    expect(p.immediateIncome).toBe(0)
    expect(p.developerCommissions).toBe(0)
  })

  it('אופטימי = קצב × 1.2', () => {
    expect(at('2026-10', 'optimistic').expectedDeals).toBeCloseTo(
      at('2026-10', 'base').expectedDeals * OPTIMISTIC_FACTOR, 2,
    )
  })

  it('הנחה נדרסת ידנית לתרחיש "מה אם" ומסומנת ככזו', () => {
    const whatIf = computeRealEstateForecast([], {
      asOf: ASOF, deals: reDeals, plans: [], fixedExpenses: reFixed,
      overrides: { 're.dealsPerMonth': 5 },
    })
    const base = whatIf.find((f) => f.month === '2026-10' && f.scenario === 'base')!
    expect(base.expectedDeals).toBe(5)
    expect(base.assumptions.find((a) => a.key === 're.dealsPerMonth')!.overridden).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// §3.7.2 — מימון
// ════════════════════════════════════════════════════════════════════════════

describe('התפלגות זמן חתימה→גביה — SPEC §3.7.2', () => {
  const deals: Deal[] = [
    deal({ id: 'd1', product: 'vehicle_lien', signedAt: '2026-08-01' }),
    deal({ id: 'd2', product: 'vehicle_lien', signedAt: '2026-08-10' }),
    deal({ id: 'd3', product: 'business_credit', signedAt: '2026-07-01' }),
    deal({ id: 'd4', product: 'business_credit', signedAt: '2026-07-05' }),
  ]
  const txs: Transaction[] = [
    income('t1', 5_000, '2026-08-03', 'd1'),  // רכב: מיידי → פיגור 0
    income('t2', 5_000, '2026-08-12', 'd2'),  // פיגור 0
    income('t3', 30_000, '2026-08-01', 'd3'), // אשראי: ~31 יום → פיגור 1
    income('t4', 30_000, '2026-09-05', 'd4'), // ~62 יום → פיגור 2
  ]

  it('רכב נגבה מיידית — כל המסה בפיגור 0', () => {
    const dist = measureLagDistribution(deals, txs, 'vehicle_lien')!
    expect(dist.get(0)).toBe(1)
  })

  it('אשראי עסקי מתפלג על שני חודשים, לא מתרכז בממוצע אחד', () => {
    const dist = measureLagDistribution(deals, txs, 'business_credit')!
    expect(dist.get(1)).toBe(0.5)
    expect(dist.get(2)).toBe(0.5)
    // ממוצע היה נותן 1.5 — חודש שאף עסקה לא נגבתה בו
    expect(dist.get(1.5)).toBeUndefined()
  })

  it('סכום המשקלים 1', () => {
    const dist = measureLagDistribution(deals, txs)!
    expect([...dist.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })

  it('בלי נתונים מחזיר null ולא ממוצע מומצא', () => {
    expect(measureLagDistribution([], [], 'x')).toBeNull()
  })
})

describe('תחזית מימון — SPEC §3.7.2', () => {
  const finDeals: Deal[] = [
    deal({ id: 'f1', product: 'business_credit', feeAgreedNet: 40_000, advanceAtSigningNet: 10_000, signedAt: '2026-08-01' }),
    deal({ id: 'f2', product: 'business_credit', feeAgreedNet: 40_000, advanceAtSigningNet: 10_000, signedAt: '2026-08-20' }),
    deal({ id: 'f3', product: 'vehicle_lien', feeAgreedNet: 10_000, advanceAtSigningNet: 0, signedAt: '2026-09-01' }),
  ]
  const txs: Transaction[] = [
    income('t1', 40_000, '2026-09-01', 'f1'), // פיגור 1
    income('t2', 40_000, '2026-09-20', 'f2'), // פיגור 1
    income('t3', 10_000, '2026-09-02', 'f3'), // פיגור 0
  ]
  const finFixed = [fixed({ id: 'fx-fin', amountNet: 60_000 })]

  const forecast = computeFinanceForecast(txs, {
    asOf: ASOF,
    deals: finDeals,
    plans: [],
    fixedExpenses: finFixed,
    nissimOpeningBalance: 36_517,
    expectedMonthlyAdvance: 19_000,
  })

  const at = (month: string, scenario: string) =>
    forecast.find((f) => f.month === month && f.scenario === scenario)!

  it('קצב חתימות ושכ"ט נמדדים לפי מוצר, לא במצטבר', () => {
    const rates = computeFinanceRates(finDeals, txs, ASOF)
    const credit = rates.find((r) => r.product === 'business_credit')!
    const vehicle = rates.find((r) => r.product === 'vehicle_lien')!
    expect(credit.avgFeeNet).toBe(40_000)
    expect(vehicle.avgFeeNet).toBe(10_000)
    expect(vehicle.avgAdvanceNet).toBe(0) // ברכב אין מקדמה בחתימה
  })

  it('מקדמות בחתימה מיידיות', () => {
    expect(at('2026-10', 'base').signingAdvances).toBeGreaterThan(0)
  })

  it('גביה מחתימות חדשות נפרסת לפי ההתפלגות', () => {
    // רכב (פיגור 0) נכנס כבר בחודש הראשון; אשראי (פיגור 1) רק בשני
    const oct = at('2026-10', 'base')
    const nov = at('2026-11', 'base')
    expect(oct.newBusinessCollections).toBeGreaterThan(0)
    expect(nov.newBusinessCollections).toBeGreaterThan(oct.newBusinessCollections)
  })

  it('פסימי: אפס חתימות חדשות, אפס מקדמות חתימה', () => {
    const p = at('2026-10', 'pessimistic')
    expect(p.expectedSignings).toBe(0)
    expect(p.newBusinessCollections).toBe(0)
    expect(p.signingAdvances).toBe(0)
  })

  it('חלק ניסים 50% והיתרה להר-אל', () => {
    const b = at('2026-10', 'base')
    expect(b.nissimShare).toBe(b.distributableProfit / 2)
    expect(b.nissimShare + b.harelShare).toBe(b.distributableProfit)
  })

  it('יתרת ניסים מתגלגלת: פתיחה + מקדמות − חלקו', () => {
    const oct = at('2026-10', 'base')
    expect(oct.nissimExpectedBalance).toBe(36_517 + 19_000 - oct.nissimShare)
    const nov = at('2026-11', 'base')
    expect(nov.nissimExpectedBalance).toBe(
      oct.nissimExpectedBalance + 19_000 - nov.nissimShare,
    )
  })

  it('הוצאות ישירות ממוצעות לתיק × תיקים צפויים', () => {
    const withDirect = computeFinanceForecast(txs, {
      asOf: ASOF, deals: finDeals, plans: [], fixedExpenses: finFixed,
      avgDirectCostPerDeal: 3_000,
    })
    const b = withDirect.find((f) => f.month === '2026-10' && f.scenario === 'base')!
    expect(b.expenses).toBeCloseTo(60_000 + 3_000 * b.expectedSignings, 0)
  })

  it('פייפליין committed נכנס גם בתרחיש פסימי', () => {
    const plans: DealPaymentPlan[] = [
      { id: 'p1', dealId: 'f1', label: 'יתרה', amountNet: 25_000, expectedDate: '2026-10-15', certainty: 'committed', probability: 1 },
      { id: 'p2', dealId: 'f2', label: 'צפי', amountNet: 40_000, expectedDate: '2026-10-20', certainty: 'expected', probability: 0.5 },
    ]
    const withPipeline = computeFinanceForecast(txs, {
      asOf: ASOF, deals: finDeals, plans, fixedExpenses: finFixed,
    })
    const p = withPipeline.find((f) => f.month === '2026-10' && f.scenario === 'pessimistic')!
    const b = withPipeline.find((f) => f.month === '2026-10' && f.scenario === 'base')!
    expect(p.pipelineCollections).toBe(25_000)
    expect(b.pipelineCollections).toBeGreaterThan(25_000)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// §3.7.3 — מאוחד
// ════════════════════════════════════════════════════════════════════════════

describe('תחזית מאוחדת — SPEC §3.7.3', () => {
  const reDeals = [
    deal({ id: 're1', division: 'realestate', product: 'presale', stage: 're_closed', feeAgreedNet: 50_000, signedAt: '2026-08-01' }),
  ]
  const finDeals = [
    deal({ id: 'f1', product: 'business_credit', feeAgreedNet: 40_000, signedAt: '2026-08-01' }),
  ]
  const sharedFixed = [
    fixed({ id: 'fx-hadas', amountNet: 20_000, division: 'shared', divisionSplit: { finance: 0.8, realestate: 0.2 } }),
  ]

  const re = computeRealEstateForecast([], {
    asOf: ASOF, deals: reDeals, plans: [], fixedExpenses: sharedFixed,
  })
  const fin = computeFinanceForecast([], {
    asOf: ASOF, deals: finDeals, plans: [], fixedExpenses: sharedFixed,
  })

  it('הוצאה משותפת נספרת פעם אחת בדיוק בין שתי התחזיות', () => {
    expect(sharedExpenseDoubleCount(sharedFixed, '2026-10')).toBe(0)
    // כל צד נושא את חלקו
    expect(re.find((m) => m.month === '2026-10' && m.scenario === 'base')!.expenses).toBe(4_000)
    expect(fin.find((m) => m.month === '2026-10' && m.scenario === 'base')!.expenses).toBe(16_000)
  })

  it('היתרה מתגלגלת: פתיחה + נדל"ן + מימון − מע"מ − משיכות', () => {
    const unified = computeUnifiedForecast(re, fin, {
      openingBalance: 100_000,
      vatByMonth: new Map([['2026-10', 5_000]]),
      otherDrawsByMonth: new Map([['2026-10', 2_000]]),
    })
    const oct = unified.find((m) => m.month === '2026-10')!
    expect(oct.expectedClosingBalance).toBe(
      100_000 + oct.realEstateNet + oct.financeNet - 5_000 - 2_000,
    )
    const nov = unified.find((m) => m.month === '2026-11')!
    expect(nov.openingBalance).toBe(oct.expectedClosingBalance)
  })

  it('אפשר לשלב תרחישים: נדל"ן פסימי + מימון בסיס', () => {
    const mixed = computeUnifiedForecast(re, fin, {
      openingBalance: 0,
      realEstateScenario: 'pessimistic',
      financeScenario: 'base',
    })
    const allBase = computeUnifiedForecast(re, fin, { openingBalance: 0 })
    expect(mixed[0]!.realEstateScenario).toBe('pessimistic')
    expect(mixed[0]!.financeScenario).toBe('base')
    expect(mixed[0]!.realEstateNet).not.toBe(allBase[0]!.realEstateNet)
    expect(mixed[0]!.financeNet).toBe(allBase[0]!.financeNet)
  })

  it('מקדם התרחיש על עסקים חדשים', () => {
    expect(newBusinessFactor('pessimistic')).toBe(0)
    expect(newBusinessFactor('base')).toBe(1)
    expect(newBusinessFactor('optimistic')).toBe(1.2)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// דיוק התחזית
// ════════════════════════════════════════════════════════════════════════════

describe('דיוק התחזית — SPEC §3.7.3', () => {
  const snapshots: ForecastSnapshot[] = [
    { targetMonth: '2026-09', forecastedAt: '2026-08-19', horizonDays: 30, division: 'finance', scenario: 'base', predictedCollections: 90_000, predictedProfit: 20_000 },
    { targetMonth: '2026-09', forecastedAt: '2026-07-20', horizonDays: 60, division: 'finance', scenario: 'base', predictedCollections: 70_000, predictedProfit: 10_000 },
  ]
  const actual = new Map([['finance|2026-09', 98_000]])

  it('משווה מה נחזה מול מה קרה, לכל אופק בנפרד', () => {
    const acc = computeForecastAccuracy(snapshots, actual)
    expect(acc).toHaveLength(2)
    const at30 = acc.find((a) => a.horizonDays === 30)!
    expect(at30.variance).toBe(8_000)
    expect(at30.accuracyPct).toBeCloseTo(91.84, 1)
  })

  it('אופק ארוך יותר פחות מדויק — וזה מה שהמסך מציג', () => {
    const acc = computeForecastAccuracy(snapshots, actual)
    const at30 = acc.find((a) => a.horizonDays === 30)!
    const at60 = acc.find((a) => a.horizonDays === 60)!
    expect(at60.accuracyPct!).toBeLessThan(at30.accuracyPct!)
  })

  it('חודש שעוד לא נסגר אינו מדווח', () => {
    expect(computeForecastAccuracy(snapshots, new Map())).toHaveLength(0)
  })

  it('חלוקה באפס מחזירה null ולא NaN', () => {
    const acc = computeForecastAccuracy(snapshots, new Map([['finance|2026-09', 0]]))
    expect(acc[0]!.accuracyPct).toBeNull()
  })
})
