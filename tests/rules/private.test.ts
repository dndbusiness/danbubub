import { describe, expect, it } from 'vitest'
import {
  evaluateThreshold,
  splitPrivateRow,
  summarizePrivateIncome,
  type PrivateIncomeRow,
} from '@/lib/rules/private.js'

const row = (over: Partial<PrivateIncomeRow> = {}): PrivateIncomeRow => ({
  id: over.id ?? 'p1',
  fundName: over.fundName ?? 'קרן א',
  dealAmount: over.dealAmount ?? 1_000_000,
  pct: over.pct ?? 0.01,
  amountNet: over.amountNet ?? 10_000,
  vatAmount: over.vatAmount ?? 0,
  splitDan: over.splitDan ?? 0.5,
  splitNissim: over.splitNissim ?? 0.5,
  status: over.status ?? 'expected',
  receivedDate: over.receivedDate ?? null,
  dealRef: over.dealRef ?? null,
})

describe('הכנסות פרייבט — SPEC §2.1, מסך 9', () => {
  it('חלוקה 50/50 שווה בדיוק לסכום', () => {
    const s = splitPrivateRow({ amountNet: 10_000, splitDan: 0.5, splitNissim: 0.5 })
    expect(s.dan).toBe(5_000)
    expect(s.nissim).toBe(5_000)
  })

  it('סכום אי-זוגי לא מאבד אגורה (§11.5)', () => {
    const s = splitPrivateRow({ amountNet: 10_000.01, splitDan: 0.5, splitNissim: 0.5 })
    expect(s.dan + s.nissim).toBeCloseTo(10_000.01, 2)
  })

  it('חלוקה לא שוויונית מכובדת', () => {
    const s = splitPrivateRow({ amountNet: 9_000, splitDan: 0.7, splitNissim: 0.3 })
    expect(s.dan).toBe(6_300)
    expect(s.nissim).toBe(2_700)
  })

  it('סיכום מפריד צפוי מהתקבל ולא מערבב', () => {
    const sum = summarizePrivateIncome([
      row({ id: 'a', amountNet: 10_000, status: 'expected' }),
      row({ id: 'b', amountNet: 6_000, status: 'received', receivedDate: '2026-09-01' }),
      row({ id: 'c', fundName: 'קרן ב', amountNet: 4_000, status: 'received', receivedDate: '2026-09-10' }),
    ])
    expect(sum.expected.rows).toBe(1)
    expect(sum.expected.amountNet).toBe(10_000)
    expect(sum.received.amountNet).toBe(10_000)
    expect(sum.total.amountNet).toBe(20_000)
    expect(sum.total.dan).toBe(10_000)
    expect(sum.total.nissim).toBe(10_000)
  })

  it('פילוח לפי קרן ממוין מהגדול לקטן', () => {
    const sum = summarizePrivateIncome([
      row({ id: 'a', fundName: 'קטנה', amountNet: 1_000 }),
      row({ id: 'b', fundName: 'גדולה', amountNet: 50_000 }),
    ])
    expect(sum.byFund[0]!.fundName).toBe('גדולה')
    expect(sum.byFund[1]!.fundName).toBe('קטנה')
  })

  it('סף לפי עסקה — מעל הסף זכאי, מתחתיו לא', () => {
    const rule = { type: 'per_deal', min: 500_000, pct: 0.01 }
    const yes = evaluateThreshold(rule, { dealAmount: 1_200_000 })!
    expect(yes.applies).toBe(true)
    expect(yes.amount).toBe(12_000)
    const no = evaluateThreshold(rule, { dealAmount: 300_000 })!
    expect(no.applies).toBe(false)
    expect(no.amount).toBe(0)
  })

  it('סף לפי מחזור חודשי — הדוגמה שב-§2.1 ("מעל 3M חודשי → 1%")', () => {
    const rule = { type: 'monthly_volume', min: 3_000_000, pct: 0.01 }
    const yes = evaluateThreshold(rule, { dealAmount: 250_000, monthlyVolume: 4_100_000 })!
    expect(yes.applies).toBe(true)
    expect(yes.amount).toBe(2_500)
    expect(evaluateThreshold(rule, { dealAmount: 250_000, monthlyVolume: 1_000_000 })!.applies).toBe(false)
  })

  it('כלל שלא מוכר מחזיר null — המערכת לא מנחשת אחוז (שאלה #7)', () => {
    expect(evaluateThreshold(null, { dealAmount: 1_000_000 })).toBeNull()
    expect(evaluateThreshold('מעל 3 מיליון', { dealAmount: 1_000_000 })).toBeNull()
    expect(evaluateThreshold({ type: 'something_else', min: 1, pct: 0.01 }, { dealAmount: 1_000_000 })).toBeNull()
    // מחזור חודשי בלי נתון מחזור — אין תשובה, לא "לא זכאי".
    expect(evaluateThreshold({ type: 'monthly_volume', min: 3_000_000, pct: 0.01 }, { dealAmount: 1_000 })).toBeNull()
  })
})
