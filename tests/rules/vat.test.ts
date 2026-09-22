import { describe, expect, it } from 'vitest'
import { computeVat, computeVatLiability, vatRateOn } from '@/lib/rules/vat.js'
import type { Transaction } from '@/lib/rules/types.js'

const RATE = 0.18

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: 'tx',
    dateCash: '2026-09-10',
    accountId: 'acc',
    amountNet: 0,
    vatMode: 'excl',
    vatRate: RATE,
    vatAmount: 0,
    amountGross: 0,
    nature: 'expense',
    division: 'finance',
    txClass: 'business',
    certainty: 'actual',
    invoiceStatus: 'has_invoice',
    ...over,
  }
}

describe('פירוק מע"מ — SPEC §1.4', () => {
  it('excl (ברירת מחדל): הסכום הוא הנטו', () => {
    expect(computeVat(1_000, 'excl', RATE)).toEqual({
      amountNet: 1_000,
      vatAmount: 180,
      amountGross: 1_180,
    })
  })

  it('incl: הסכום הוא הברוטו, והנטו נגזר', () => {
    const r = computeVat(1_180, 'incl', RATE)
    expect(r).toEqual({ amountNet: 1_000, vatAmount: 180, amountGross: 1_180 })
  })

  it('excl ו-incl הם היפוך מדויק זה של זה', () => {
    const excl = computeVat(7_432.19, 'excl', RATE)
    const back = computeVat(excl.amountGross, 'incl', RATE)
    expect(back.amountNet).toBeCloseTo(7_432.19, 2)
  })

  it('exempt: אין מע"מ, ברוטו = נטו', () => {
    expect(computeVat(500, 'exempt', RATE)).toEqual({
      amountNet: 500,
      vatAmount: 0,
      amountGross: 500,
    })
  })

  it('סכום שלילי (הוצאה) שומר על הסימן', () => {
    expect(computeVat(-1_000, 'excl', RATE)).toEqual({
      amountNet: -1_000,
      vatAmount: -180,
      amountGross: -1_180,
    })
  })

  it('שיעור לא חוקי נופל', () => {
    expect(() => computeVat(100, 'excl', 18)).toThrow()
  })
})

describe('שיעור מע"מ לפי תאריך — SPEC §3.1 "היסטוריה של שיעורים"', () => {
  const history = [
    { from: '2020-01-01', rate: 0.17 },
    { from: '2025-01-01', rate: 0.18 },
  ]

  it('בוחר את השיעור שבתוקף', () => {
    expect(vatRateOn('2024-06-30', history)).toBe(0.17)
    expect(vatRateOn('2026-09-01', history)).toBe(0.18)
  })

  it('תאריך לפני כל שיעור מוגדר נופל ולא מחזיר ברירת מחדל שקטה', () => {
    expect(() => vatRateOn('2019-12-31', history)).toThrow()
  })
})

describe('חבות מע"מ — SPEC §3.1', () => {
  const txs: Transaction[] = [
    tx({ id: 'in-1', nature: 'income', amountNet: 100_000, vatAmount: 18_000 }),
    tx({ id: 'ex-1', amountNet: -20_000, vatAmount: -3_600, invoiceStatus: 'has_invoice' }),
    tx({ id: 'ex-2', amountNet: -10_000, vatAmount: -1_800, invoiceStatus: 'missing' }),
    tx({ id: 'ex-3', amountNet: -5_000, vatAmount: -900, invoiceStatus: 'no_invoice_needed' }),
  ]
  const range = { from: '2026-09-01', to: '2026-09-30' }

  it('חבות = מע"מ עסקאות − מע"מ תשומות שיש לו חשבונית', () => {
    const r = computeVatLiability(txs, range)
    expect(r.outputVat).toBe(18_000)
    expect(r.inputVatClaimable).toBe(3_600)
    expect(r.liability).toBe(14_400)
  })

  it('תשומות שחסרה להן חשבונית מוצגות בנפרד — "כמה כסף אתה מפסיד"', () => {
    const r = computeVatLiability(txs, range)
    expect(r.inputVatMissingInvoice).toBe(1_800)
    expect(r.missingInvoiceCount).toBe(1)
  })

  it('no_invoice_needed לא נספרת כחסרה (SPEC §4.3)', () => {
    const r = computeVatLiability(txs, range)
    expect(r.inputVatMissingInvoice).toBe(1_800) // ex-3 לא נכללה
  })

  it('הכנסות פרייבט אינן בחישוב מע"מ החברה (SPEC §3.1)', () => {
    const withPrivate = [...txs, tx({ id: 'pv', nature: 'income', division: 'private', amountNet: 50_000, vatAmount: 9_000 })]
    expect(computeVatLiability(withPrivate, range).outputVat).toBe(18_000)
  })

  it('שיוך לתקופה לפי תאריך המסמך כשהוא קיים', () => {
    const crossing = [tx({ id: 'x', nature: 'income', dateCash: '2026-10-02', dateDoc: '2026-09-28', amountNet: 1_000, vatAmount: 180 })]
    expect(computeVatLiability(crossing, range).outputVat).toBe(180)
  })
})
