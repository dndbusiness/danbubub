import { describe, expect, it } from 'vitest'
import {
  computeNissimCard,
  computeNissimCardSeries,
  findClosingBlockers,
  findCardMismatches,
} from '@/lib/rules/nissim-card.js'
import type { Transaction } from '@/lib/rules/types.js'
import {
  advances,
  deals,
  DEFAULT_SPLIT,
  fixedExpenses,
  MONTHS,
  OPENING_BALANCE,
  TARGET_CLOSING_BALANCE,
  TARGETS,
  transactions,
} from '../fixtures/nissim-card-2026.js'

const baseOpts = {
  defaultSplit: DEFAULT_SPLIT,
  deals,
  fixedExpenses,
  advances,
}

describe('כרטיס ניסים — קריטריון הסיום של שלב 1 (SPEC §8)', () => {
  const series = computeNissimCardSeries(transactions, MONTHS, {
    ...baseOpts,
    openingBalance: OPENING_BALANCE,
  })

  it.each(MONTHS)('רווח לחלוקה ב-%s מתקבל לשקל', (month) => {
    const card = series.find((c) => c.month === month)!
    expect(card.distributableProfit).toBe(TARGETS[month])
  })

  it('יתרת ניסים בסוף ספטמבר מתקבלת לשקל', () => {
    const september = series[2]!
    expect(september.closingBalance).toBe(TARGET_CLOSING_BALANCE)
  })

  it('היתרה מתגלגלת: סגירת חודש = פתיחת החודש הבא', () => {
    expect(series[1]!.openingBalance).toBe(series[0]!.closingBalance)
    expect(series[2]!.openingBalance).toBe(series[1]!.closingBalance)
  })

  it('יתרה חיובית = ניסים חייב לחברה, ולכן אין העברה', () => {
    expect(series[2]!.closingBalance).toBeGreaterThan(0)
    expect(series[2]!.transferDueBy10th).toBe(0)
  })
})

describe('כרטיס ניסים — 8 שורות החישוב (SPEC §3.3)', () => {
  const july = computeNissimCard(transactions, {
    ...baseOpts,
    month: '2026-07',
    openingBalance: OPENING_BALANCE,
  })

  it('שורה 1: רק income actual עם deal_id בפעילות המימון', () => {
    expect(july.collectedIncome).toBe(45_000)
  })

  it('שורה 2: הוצאה קבועה שאינה מאושרת אינה נכנסת לחלוקה', () => {
    // 8,000 + 30,000 + (5,000×0.8) + 3,000 + (20,327.5×0.8) = 61,262
    expect(july.approvedFixedExpenses).toBe(61_262)
    const fixedIds = july.lines[1]!.txIds
    const unapproved = transactions.find((t) => t.fixedExpenseId === 'fx-unapproved')!
    expect(fixedIds).not.toContain(unapproved.id)
  })

  it('שורה 2: הוצאה משותפת נכנסת רק בחלק המימון (80%)', () => {
    const hadas = transactions.find(
      (t) => t.fixedExpenseId === 'fx-hadas' && t.dateCash.startsWith('2026-07'),
    )!
    expect(hadas.amountNet).toBe(-20_327.5)
    // התרומה שלה לשורה 2 היא 16,262 ולא 20,327.5
    const withoutHadas = computeNissimCard(
      transactions.filter((t) => t.id !== hadas.id),
      { ...baseOpts, month: '2026-07', openingBalance: OPENING_BALANCE },
    )
    expect(july.approvedFixedExpenses - withoutHadas.approvedFixedExpenses).toBe(16_262)
  })

  it('שורה 3: הוצאות ישירות לפי deal_id', () => {
    expect(july.directExpenses).toBe(12_000)
  })

  it('שורה 4: רווח = 1 − 2 − 3', () => {
    expect(july.distributableProfit).toBe(45_000 - 61_262 - 12_000)
  })

  it('שורה 5: חודש הפסד — ניסים נושא ב-50% (ברירת מחדל, שאלה פתוחה #5)', () => {
    expect(july.nissimShare).toBe(-14_131)
    expect(july.harelShare).toBe(-14_131)
  })

  it('שורה 5: lossSharing=harel_absorbs מאפס את חלקו בחודש הפסד', () => {
    const absorbed = computeNissimCard(transactions, {
      ...baseOpts,
      month: '2026-07',
      openingBalance: OPENING_BALANCE,
      lossSharing: 'harel_absorbs',
    })
    expect(absorbed.nissimShare).toBe(0)
    expect(absorbed.harelShare).toBe(-28_262)
  })

  it('שורה 6: מקדמות החודש', () => {
    expect(july.advancesThisMonth).toBe(19_000)
  })

  it('שורה 7: יתרה = פתיחה + מקדמות − חלק ניסים', () => {
    expect(july.closingBalance).toBe(OPENING_BALANCE + 19_000 - -14_131)
  })

  it('שורה 8: החברה חייבת → העברה נדרשת; ניסים חייב → 0', () => {
    const owedToNissim = computeNissimCard(transactions, {
      ...baseOpts,
      month: '2026-08',
      openingBalance: -100_000,
    })
    expect(owedToNissim.closingBalance).toBeLessThan(0)
    expect(owedToNissim.transferDueBy10th).toBe(-owedToNissim.closingBalance)
  })
})

describe('כרטיס ניסים — מה שאסור שייכנס (SPEC §1.3, §2.1)', () => {
  const july = computeNissimCard(transactions, {
    ...baseOpts,
    month: '2026-07',
    openingBalance: 0,
  })
  const allLineTxIds = new Set(july.lines.flatMap((l) => l.txIds))

  it.each(['advance', 'draw', 'transfer'] as const)(
    'nature=%s אינה נכנסת לרווח והפסד',
    (nature) => {
    const offenders = transactions.filter(
      (t) => t.nature === nature && t.dateCash.startsWith('2026-07'),
    )
    expect(offenders.length).toBeGreaterThan(0)
    for (const tx of offenders) expect(allLineTxIds.has(tx.id)).toBe(false)
    },
  )

  it('division=private אינה נכנסת לשום דוח עסקי', () => {
    const priv = transactions.find((t) => t.division === 'private')!
    expect(allLineTxIds.has(priv.id)).toBe(false)
  })

  it('הכנסת נדל"ן אינה נכנסת לכרטיס ניסים', () => {
    const re = transactions.find((t) => t.division === 'realestate' && t.nature === 'income')!
    expect(allLineTxIds.has(re.id)).toBe(false)
  })

  it('הוצאה לא מוכרת (deductible=false) אינה נכנסת', () => {
    const nonDeductible = transactions.find((t) => t.deductible === false)!
    expect(allLineTxIds.has(nonDeductible.id)).toBe(false)
  })

  it('certainty≠actual אינה נכנסת', () => {
    const withExpected: Transaction[] = [
      ...transactions,
      {
        ...transactions.find((t) => t.nature === 'income')!,
        id: 'tx-expected',
        certainty: 'expected',
        amountNet: 999_999,
      },
    ]
    const card = computeNissimCard(withExpected, {
      ...baseOpts,
      month: '2026-07',
      openingBalance: 0,
    })
    expect(card.collectedIncome).toBe(45_000)
  })
})

describe('שיוך תקבול שני לחודש שבו נכנס (SPEC §3.4, ליקוי #3)', () => {
  it('יתרת השכ"ט של תיק יולי נספרת בספטמבר', () => {
    const july = computeNissimCard(transactions, {
      ...baseOpts,
      month: '2026-07',
      openingBalance: 0,
    })
    const september = computeNissimCard(transactions, {
      ...baseOpts,
      month: '2026-09',
      openingBalance: 0,
    })

    // התיק נסגר על 68,000 — אבל ביולי נגבו רק 30,000.
    const dealJul1 = deals.find((d) => d.id === 'deal-jul-1')!
    expect(dealJul1.feeAgreedNet).toBe(68_000)
    expect(july.collectedIncome).toBe(45_000)

    // ה-38,000 הנותרים נספרים בספטמבר.
    const secondReceipt = september.lines[0]!.txIds
      .map((id) => transactions.find((t) => t.id === id)!)
      .find((t) => t.dealId === 'deal-jul-1')
    expect(secondReceipt?.amountNet).toBe(38_000)
  })

  it('ההוצאות הישירות של תיק יולי נשארות ביולי, גם כשהתקבול השני בספטמבר', () => {
    const september = computeNissimCard(transactions, {
      ...baseOpts,
      month: '2026-09',
      openingBalance: 0,
    })
    expect(september.directExpenses).toBe(14_000) // רק של תיק ספטמבר
  })
})

describe('חריגים שחוסמים סגירת חודש (SPEC §3.3 שלב 2)', () => {
  it('תנועה לא מזוהה חוסמת', () => {
    const withUnknown: Transaction[] = [
      ...transactions,
      { ...transactions[0]!, id: 'tx-unknown', reviewStatus: 'unknown_expense' },
    ]
    const blockers = findClosingBlockers(withUnknown, {
      month: '2026-07',
      deals,
      advances,
    })
    expect(blockers.some((b) => b.kind === 'unknown_expense')).toBe(true)
  })

  it('מקדמה בלי חודש קיזוז חוסמת', () => {
    const blockers = findClosingBlockers(transactions, {
      month: '2026-07',
      deals,
      advances: [...advances, { id: 'adv-x', date: '2026-07-01', amountGross: 5_000, method: 'cash', period: '' }],
    })
    expect(blockers.some((b) => b.kind === 'advance_without_period')).toBe(true)
  })

  it('חודש נקי אינו מחזיר חריגים', () => {
    expect(findClosingBlockers(transactions, { month: '2026-07', deals, advances })).toEqual([])
  })

  it('בנות אשראי שלא מסתכמות לאב מסומנות (SPEC §2.1)', () => {
    const parent: Transaction = { ...transactions[2]!, id: 'tx-parent', amountGross: -1_000, amountNet: -1_000, parentId: null }
    const child: Transaction = { ...transactions[2]!, id: 'tx-child', amountGross: -600, amountNet: -600, parentId: 'tx-parent' }
    expect(findCardMismatches([parent, child])).toHaveLength(1)

    const child2: Transaction = { ...child, id: 'tx-child-2', amountGross: -400, amountNet: -400 }
    expect(findCardMismatches([parent, child, child2])).toHaveLength(0)
  })
})
