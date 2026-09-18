import { describe, expect, it } from 'vitest'
import {
  averageRecentAdvances,
  computeCashflow13w,
  computeDailyClose,
  isAnchorStale,
} from '@/lib/rules/cashflow.js'
import type { Balance, Deal, DealPaymentPlan, FixedExpense } from '@/lib/rules/types.js'
import { advances } from '../fixtures/nissim-card-2026.js'

const anchor: Balance = {
  date: '2026-09-13', // יום ראשון
  accountId: 'acc-bank',
  balance: 100_000,
  source: 'manual',
}

const rent: FixedExpense = {
  id: 'fx-rent',
  name: 'שכירות',
  categoryId: 'cat-fixed',
  division: 'finance',
  amountNet: 8_000,
  vatMode: 'excl',
  frequency: 'monthly',
  dayOfMonth: 1,
  accountId: 'acc-bank',
  variable: false,
  approvedByNissim: true,
  startDate: '2026-01-01',
  active: true,
}

const deal: Deal = {
  id: 'deal-1',
  clientName: 'לקוח',
  division: 'finance',
  product: 'business_credit',
  stage: 'submitted', // 50%
  collectionStatus: 'not_collected',
  feeAgreedNet: 40_000,
  feeMode: 'fixed',
  status: 'open',
  lastActivityAt: '2026-09-10',
}

const plans: DealPaymentPlan[] = [
  { id: 'p-committed', dealId: 'deal-1', label: 'מקדמה', amountNet: 20_000, expectedDate: '2026-09-18', certainty: 'committed', probability: 1 },
  { id: 'p-expected', dealId: 'deal-1', label: 'יתרה', amountNet: 40_000, expectedDate: '2026-09-25', certainty: 'expected', probability: 0.5 },
]

describe('תזרים 13 שבועות — SPEC §3.6', () => {
  const result = computeCashflow13w({ anchor, plans, deals: [deal], fixedExpenses: [rent] })

  it('13 שבועות כברירת מחדל', () => {
    expect(result.weeks).toHaveLength(13)
    expect(result.weeks[0]!.weekStart).toBe('2026-09-13')
  })

  it('שני קווים נפרדים: committed בלבד מול committed+expected משוקלל', () => {
    const w1 = result.weeks[0]!
    expect(w1.committedIn).toBe(20_000)
    expect(w1.balanceCommitted).toBe(120_000)
    expect(w1.balanceWeighted).toBe(120_000) // הצפי בשבוע הבא
  })

  it('צפי נספר לפי הסתברות השלב, לא במלואו', () => {
    const w2 = result.weeks[1]!
    expect(w2.expectedIn).toBe(20_000) // 40,000 × 50% (שלב "הוגש")
    expect(w2.balanceWeighted - w2.balanceCommitted).toBe(20_000)
  })

  it('הוצאה קבועה נכנסת כל חודש בתוך החלון', () => {
    const rentItems = result.weeks.flatMap((w) => w.items).filter((i) => i.refId === 'fx-rent')
    expect(rentItems.length).toBeGreaterThanOrEqual(3)
    expect(rentItems.every((i) => i.amount === -8_000)).toBe(true)
  })

  it('תקבול שכבר נכנס בפועל לא נספר שוב', () => {
    const settled = computeCashflow13w({
      anchor,
      plans: [{ ...plans[0]!, matchedTxId: 'tx-1' }, plans[1]!],
      deals: [deal],
      fixedExpenses: [rent],
    })
    expect(settled.weeks[0]!.committedIn).toBe(0)
  })

  it('נקודה נמוכה ב-90 יום מזוהה (SPEC §5 מסך 1)', () => {
    expect(result.lowPoint).not.toBeNull()
    const balances = result.weeks.map((w) => w.balanceCommitted)
    expect(result.lowPoint!.balance).toBe(Math.min(...balances))
  })

  it('יתרה צפויה שלילית מדווחת עם תאריך (SPEC §3.6 התראה 1)', () => {
    const broke = computeCashflow13w({
      anchor: { ...anchor, balance: 5_000 },
      plans: [],
      deals: [],
      fixedExpenses: [rent],
    })
    expect(broke.firstNegativeWeek).not.toBeNull()
  })

  it('רקב חותך את ההסתברות של צפי מתיק שנטוש', () => {
    const stale = computeCashflow13w({
      anchor,
      plans,
      deals: [{ ...deal, lastActivityAt: '2026-07-01' }], // 74 יום → 0
      fixedExpenses: [],
    })
    expect(stale.weeks[1]!.expectedIn).toBe(0)
  })

  it('מקדמות צפויות יורדות מהתזרים ביום שנקבע', () => {
    const withAdvance = computeCashflow13w({
      anchor,
      plans: [],
      deals: [],
      fixedExpenses: [],
      expectedAdvance: 19_000,
      advanceDayOfMonth: 19,
    })
    const items = withAdvance.weeks.flatMap((w) => w.items).filter((i) => i.kind === 'advance')
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(items[0]!.date).toBe('2026-09-19')
  })
})

describe('סגירת יום ועוגן — SPEC §3.6', () => {
  it('סטייה = עוגן היום − צפי אתמול', () => {
    const r = computeDailyClose(100_000, 97_500, '2026-09-14', 1_000)
    expect(r.variance).toBe(-2_500)
    expect(r.exceedsThreshold).toBe(true)
  })

  it('סטייה מתחת לסף לא מתריעה', () => {
    expect(computeDailyClose(100_000, 99_800, '2026-09-14', 1_000).exceedsThreshold).toBe(false)
  })

  it('עוגן שלא עודכן 48 שעות מסומן (התראה 3)', () => {
    expect(isAnchorStale('2026-09-10', '2026-09-14')).toBe(true)
    expect(isAnchorStale('2026-09-13', '2026-09-14')).toBe(false)
  })

  it('מקדמה צפויה = ממוצע 3 חודשים אחרונים', () => {
    // (25,100 + 41,550 + 19,900) / 3 — מהקובץ האמיתי
    expect(averageRecentAdvances(advances, '2026-10')).toBe(28_850)
  })

  it('אין היסטוריית מקדמות → 0, לא חלוקה באפס', () => {
    expect(averageRecentAdvances([], '2026-10')).toBe(0)
  })
})
