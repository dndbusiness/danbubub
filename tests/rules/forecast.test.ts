import { describe, expect, it } from 'vitest'
import { computeForecast, computeRunRates, OPTIMISTIC_FACTOR } from '@/lib/rules/forecast.js'
import type { Deal, DealPaymentPlan, FixedExpense, Transaction } from '@/lib/rules/types.js'

const ASOF = '2026-09-18'

function deal(id: string, fee: number, signedAt: string, stage: Deal['stage'] = 'submitted'): Deal {
  return {
    id, clientName: id, division: 'finance', product: 'business_credit', stage,
    collectionStatus: 'not_collected', feeAgreedNet: fee, feeMode: 'fixed', status: 'open',
    signedAt, lastActivityAt: signedAt,
  }
}

function income(id: string, amount: number, date: string, dealId?: string): Transaction {
  return {
    id, dateCash: date, accountId: 'acc', amountNet: amount, vatMode: 'excl', vatRate: 0.18,
    vatAmount: amount * 0.18, amountGross: amount * 1.18, nature: 'income', division: 'finance',
    txClass: 'business', certainty: 'actual', invoiceStatus: 'has_invoice', dealId,
  }
}

const deals = [
  deal('d1', 40_000, '2026-08-05'),
  deal('d2', 40_000, '2026-08-20'),
  deal('d3', 40_000, '2026-09-05'),
  deal('d4', 40_000, '2026-09-12'),
]

const txs = [
  income('t1', 20_000, '2026-08-26', 'd1'),
  income('t2', 20_000, '2026-09-10', 'd2'),
  income('t3', 20_000, '2026-09-16', 'd3'),
]

const fixedExpenses: FixedExpense[] = [
  {
    id: 'fx', name: 'קבועות', categoryId: 'c', division: 'finance', amountNet: 60_000,
    vatMode: 'excl', frequency: 'monthly', dayOfMonth: 1, accountId: 'acc', variable: false,
    approvedByNissim: true, startDate: '2026-01-01', active: true,
  },
]

const plans: DealPaymentPlan[] = [
  { id: 'p1', dealId: 'd4', label: 'מקדמה', amountNet: 30_000, expectedDate: '2026-10-10', certainty: 'committed', probability: 1 },
  { id: 'p2', dealId: 'd4', label: 'יתרה', amountNet: 40_000, expectedDate: '2026-10-20', certainty: 'expected', probability: 0.5 },
]

describe('קצבים — SPEC §3.7', () => {
  const rates = computeRunRates(deals, txs, ASOF)

  it('קצב מכירות = ממוצע נע 8 שבועות של שכ"ט שנחתם', () => {
    expect(rates.sampleSize).toBe(4)
    expect(rates.weeklySignings).toBe(20_000) // 160,000 ÷ 8
  })

  it('קצב גביה = ממוצע נע 8 שבועות של income actual', () => {
    expect(rates.weeklyCollections).toBe(7_500) // 60,000 ÷ 8
  })

  it('זמן חתימה→גביה נמדד מהנתונים ולא מונח מראש', () => {
    // d1: 5/8→26/8 = 21, d2: 20/8→10/9 = 21, d3: 5/9→16/9 = 11 → ממוצע 18
    expect(rates.avgDaysSignToCollect).toBe(18)
  })

  it('בלי נתונים מחזיר null במקום להמציא מספר', () => {
    expect(computeRunRates([], [], ASOF).avgDaysSignToCollect).toBeNull()
  })
})

describe('תחזית רבעונית, 3 תרחישים — SPEC §3.7', () => {
  const forecast = computeForecast(txs, {
    asOf: ASOF, division: 'finance', deals, plans, fixedExpenses,
  })

  it('3 חודשים × 3 תרחישים', () => {
    expect(forecast).toHaveLength(9)
    expect([...new Set(forecast.map((f) => f.month))]).toEqual(['2026-10', '2026-11', '2026-12'])
  })

  const october = (scenario: string) =>
    forecast.find((f) => f.month === '2026-10' && f.scenario === scenario)!

  it('פסימי = committed בלבד, בלי עסקים חדשים', () => {
    const p = october('pessimistic')
    expect(p.pipelineCollections).toBe(30_000)
    expect(p.newBusinessCollections).toBe(0)
    expect(p.expectedSignings).toBe(0)
  })

  it('בסיס = פייפליין משוקלל בהסתברות', () => {
    // 30,000 committed + 40,000×50% = 50,000
    expect(october('base').pipelineCollections).toBe(50_000)
  })

  it('אופטימי = בסיס ×1.2', () => {
    expect(october('optimistic').pipelineCollections).toBe(50_000 * OPTIMISTIC_FACTOR)
  })

  it('פסימי ≤ בסיס ≤ אופטימי בכל חודש', () => {
    for (const month of ['2026-10', '2026-11', '2026-12']) {
      const p = forecast.find((f) => f.month === month && f.scenario === 'pessimistic')!
      const b = forecast.find((f) => f.month === month && f.scenario === 'base')!
      const o = forecast.find((f) => f.month === month && f.scenario === 'optimistic')!
      expect(p.expectedCollections).toBeLessThanOrEqual(b.expectedCollections)
      expect(b.expectedCollections).toBeLessThanOrEqual(o.expectedCollections)
    }
  })

  it('הוצאות קבועות צפויות נכנסות לכל חודש', () => {
    expect(october('base').expectedFixedExpenses).toBe(60_000)
  })

  it('רווח צפוי = גביה − קבועות, וחלק ניסים חצי ממנו', () => {
    const b = october('base')
    expect(b.expectedDistributableProfit).toBe(b.expectedCollections - 60_000)
    expect(b.expectedNissimShare).toBe(b.expectedDistributableProfit / 2)
  })

  it('בנדל"ן אין חלק ניסים', () => {
    const re = computeForecast(txs, {
      asOf: ASOF, division: 'realestate', deals, plans, fixedExpenses,
    })
    expect(re.every((f) => f.expectedNissimShare === 0)).toBe(true)
  })

  it('עסקים חדשים נכנסים רק אחרי זמן החתימה→גביה', () => {
    // ~18 יום ≈ חודש אחד → אוקטובר (i=1) עדיין 0, נובמבר (i=2) נכנס
    expect(october('base').newBusinessCollections).toBe(0)
    const nov = forecast.find((f) => f.month === '2026-11' && f.scenario === 'base')!
    expect(nov.newBusinessCollections).toBeGreaterThan(0)
  })
})
