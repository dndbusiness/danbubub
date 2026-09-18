import { describe, expect, it } from 'vitest'
import { collectParentIds, divisionWeight, normalizeSplit, shareOf } from '@/lib/rules/division.js'
import type { Transaction } from '@/lib/rules/types.js'

const DEFAULT = { finance: 0.8, realestate: 0.2 }

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: 'tx',
    dateCash: '2026-09-01',
    accountId: 'acc',
    amountNet: -1_000,
    vatMode: 'excl',
    vatRate: 0.18,
    vatAmount: -180,
    amountGross: -1_180,
    nature: 'expense',
    division: 'finance',
    txClass: 'business',
    certainty: 'actual',
    invoiceStatus: 'has_invoice',
    ...over,
  }
}

describe('הפרדת פעילויות — SPEC §1.2', () => {
  it('אותה פעילות → כל הסכום', () => {
    expect(shareOf(tx({ division: 'finance' }), -1_000, 'finance', DEFAULT)).toBe(-1_000)
  })

  it('פעילות אחרת → אפס', () => {
    expect(shareOf(tx({ division: 'finance' }), -1_000, 'realestate', DEFAULT)).toBe(0)
  })

  it('shared מתפרק לפי מפתח השורה', () => {
    const shared = tx({ division: 'shared', divisionSplit: { finance: 0.8, realestate: 0.2 } })
    expect(shareOf(shared, -20_327.5, 'finance', DEFAULT)).toBe(-16_262)
    expect(shareOf(shared, -20_327.5, 'realestate', DEFAULT)).toBe(-4_065.5)
  })

  it('shared בלי מפתח משתמש בברירת המחדל מההגדרות', () => {
    const shared = tx({ division: 'shared' })
    expect(shareOf(shared, -1_000, 'finance', DEFAULT)).toBe(-800)
  })

  it('private לא נכנס לשום פעילות (SPEC §2.1)', () => {
    const priv = tx({ division: 'private' })
    expect(shareOf(priv, -1_000, 'finance', DEFAULT)).toBe(0)
    expect(shareOf(priv, -1_000, 'realestate', DEFAULT)).toBe(0)
  })

  it('מפתח חלוקה מנורמל גם כשלא מסתכם ל-1', () => {
    expect(normalizeSplit({ finance: 8, realestate: 2 })).toEqual({ finance: 0.8, realestate: 0.2 })
  })

  it('מפתח לא חוקי נופל ולא מחלק שקט לאפס', () => {
    expect(() => normalizeSplit({ finance: 0, realestate: 0 })).toThrow()
  })

  it('סכום שני החלקים = הסכום המלא', () => {
    const shared = tx({ division: 'shared' })
    const f = divisionWeight('shared', undefined, 'finance', DEFAULT)
    const r = divisionWeight('shared', undefined, 'realestate', DEFAULT)
    expect(f + r).toBeCloseTo(1, 10)
    expect(shareOf(shared, -1_000, 'finance', DEFAULT) + shareOf(shared, -1_000, 'realestate', DEFAULT)).toBe(-1_000)
  })

  it('איתור אבות של חיובי אשראי', () => {
    const parents = collectParentIds([
      tx({ id: 'a' }),
      tx({ id: 'b', parentId: 'a' }),
      tx({ id: 'c', parentId: 'a' }),
    ])
    expect([...parents]).toEqual(['a'])
  })
})
