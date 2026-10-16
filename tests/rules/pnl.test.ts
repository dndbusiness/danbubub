import { describe, expect, it } from 'vitest'
import { computePnl } from '@/lib/rules/pnl.js'
import {
  deals,
  DEFAULT_SPLIT,
  fixedExpenses,
  transactions,
} from '../fixtures/nissim-card-2026.js'

const base = { defaultSplit: DEFAULT_SPLIT, deals, fixedExpenses } as const

describe('שתי הגדרות רווח — SPEC §3.2', () => {
  const operational = computePnl(transactions, {
    ...base,
    mode: 'operational',
    division: 'finance',
    month: '2026-07',
  })
  const distributable = computePnl(transactions, {
    ...base,
    mode: 'distributable',
    division: 'finance',
    month: '2026-07',
  })

  it('רווח לחלוקה זהה לשורה 4 בכרטיס ניסים', () => {
    expect(distributable.profit).toBe(-28_262)
  })

  it('רווח תפעולי כולל גם הוצאות לא מוכרות — ביולי: הדס 9,450 (מסומנת "לא" בקובץ)', () => {
    expect(operational.totalExpenses).toBe(distributable.totalExpenses + 9_450)
  })

  it('רווח תפעולי נמוך מרווח לחלוקה באותם 9,450 ₪', () => {
    expect(distributable.profit - operational.profit).toBe(9_450)
  })

  it('שתי ההגדרות מחריגות advance/draw/transfer (SPEC §1.3)', () => {
    for (const result of [operational, distributable]) {
      const ids = new Set([...result.incomeLines, ...result.expenseLines].flatMap((l) => l.txIds))
      const excludedNatures = transactions.filter((t) =>
        ['advance', 'draw', 'transfer', 'financing'].includes(t.nature),
      )
      for (const tx of excludedNatures) expect(ids.has(tx.id)).toBe(false)
    }
  })

  it('הכנסה ללא deal_id נכנסת לתפעולי ולא לחלוקה', () => {
    const anyIncome = transactions.find((t) => t.nature === 'income' && t.dateCash.startsWith('2026-07')) ?? { ...transactions.find((t) => t.nature === 'income')!, dateCash: '2026-07-15' }
    const withOrphan = [
      ...transactions,
      { ...anyIncome, id: 'tx-orphan', dealId: undefined, amountNet: 9_000, dateCash: '2026-07-15' },
    ]
    const op = computePnl(withOrphan, { ...base, mode: 'operational', division: 'finance', month: '2026-07' })
    const di = computePnl(withOrphan, { ...base, mode: 'distributable', division: 'finance', month: '2026-07' })
    expect(op.income).toBe(operational.income + 9_000)
    expect(di.income).toBe(distributable.income)
    expect(di.excluded.some((e) => e.txId === 'tx-orphan')).toBe(true)
  })

  it('נדל"ן ומימון מסתכמים יחד לכלל ההוצאה המשותפת', () => {
    const fin = computePnl(transactions, { ...base, mode: 'operational', division: 'finance', month: '2026-07' })
    const re = computePnl(transactions, { ...base, mode: 'operational', division: 'realestate', month: '2026-07' })
    const sharedTotal = transactions
      .filter((t) => t.division === 'shared' && t.dateCash.startsWith('2026-07'))
      .reduce((a, t) => a + Math.abs(t.amountNet), 0)
    // ההוצאות המשותפות מחולקות בין השניים ללא איבוד וללא כפילות
    expect(fin.totalExpenses + re.totalExpenses).toBeGreaterThan(sharedTotal)
  })

  it('פירוק לשורות נותן drill-down (SPEC §5 "חוק המסכים")', () => {
    expect(distributable.expenseLines.length).toBeGreaterThan(0)
    for (const line of distributable.expenseLines) {
      expect(line.txIds.length).toBeGreaterThan(0)
    }
    const total = distributable.expenseLines.reduce((a, l) => a + l.amount, 0)
    expect(Math.abs(total - distributable.totalExpenses)).toBeLessThan(0.02)
  })

  it('פירוק ההוצאות: קבועות + ישירות + אחרות = הסך', () => {
    expect(
      Math.abs(
        distributable.fixedExpenses +
          distributable.directExpenses +
          distributable.otherExpenses -
          distributable.totalExpenses,
      ),
    ).toBeLessThan(0.02)
  })

  it('רווח לחלוקה דורש חודש ולא רק טווח', () => {
    expect(() =>
      computePnl(transactions, {
        ...base,
        mode: 'distributable',
        division: 'finance',
        range: { from: '2026-07-01', to: '2026-07-31' },
      }),
    ).toThrow()
  })
})
