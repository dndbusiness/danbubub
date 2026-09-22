import { describe, expect, it } from 'vitest'
import { computeNissimCard, computeNissimCardSeries, findCardMismatches, findClosingBlockers } from '@/lib/rules/nissim-card.js'
import type { Transaction } from '@/lib/rules/types.js'
import {
  advances, deals, DEFAULT_SPLIT, FILE_CARD, fixedExpenses, IMPORT_DATE, MONTHS, OPENING_BALANCE,
  TARGET_CLOSING_BALANCE, TARGETS, transactions, UNATTRIBUTED_INCOME,
} from '../fixtures/nissim-card-2026.js'

const baseOpts = { defaultSplit: DEFAULT_SPLIT, deals, fixedExpenses, advances }

/** מה הקובץ ספר: בלי השורות שהקובץ השמיט (תקבולים ללא חודש והוצאותיהם). */
const asFileCounted = transactions.filter((t) => t.reviewStatus !== 'ask_nissim' || t.description?.includes('הוקלד ידנית'))

describe('כרטיס ניסים — קריטריון הסיום של שלב 1 (SPEC §8), על הקובץ האמיתי', () => {
  const series = computeNissimCardSeries(asFileCounted, MONTHS, { ...baseOpts, openingBalance: OPENING_BALANCE })

  it.each(MONTHS)('רווח לחלוקה ב-%s שווה למה שהקובץ מציג, לשקל', (month) => {
    expect(series.find((c) => c.month === month)!.distributableProfit).toBe(TARGETS[month])
  })

  it('יתרת ניסים בסוף ספטמבר = 36,516.5 כמו בקובץ', () => {
    expect(series[2]!.closingBalance).toBe(TARGET_CLOSING_BALANCE)
  })

  it('מתחילים מאפס ("מנקים שולחן"): יולי = מקדמות − חלק ניסים', () => {
    expect(OPENING_BALANCE).toBe(0)
    expect(series[0]!.closingBalance).toBe(25_100 - -14_131)
    expect(series[0]!.closingBalance).toBe(FILE_CARD['2026-07'].balance)
  })

  it('כל שורה בכרטיס תואמת לעמודות הקובץ (הכנסות · מקדמות · יתרה)', () => {
    for (const c of series) {
      const f = FILE_CARD[c.month as keyof typeof FILE_CARD]
      expect(c.collectedIncome, `${c.month} הכנסות`).toBe(f.income)
      expect(c.advancesThisMonth, `${c.month} מקדמות`).toBe(f.advances)
      expect(c.closingBalance, `${c.month} יתרה`).toBe(f.balance)
    }
  })

  it('יולי: 4,862 הוצאות ישירות הוקלדו ידנית בקובץ — אצלנו בשורה 2 (ללא תיק), הרווח זהה', () => {
    const july = series[0]!
    expect(july.directExpenses).toBe(0)
    expect(july.approvedFixedExpenses).toBe(23_400 + 4_862)
    expect(july.distributableProfit).toBe(FILE_CARD['2026-07'].profit)
  })
})

describe('מה הקובץ השמיט והמערכת מציפה (ליקוי #2)', () => {
  const full = computeNissimCardSeries(transactions, MONTHS, { ...baseOpts, openingBalance: OPENING_BALANCE })
  const sep = full[2]!

  it('שלושה תקבולים ללא חודש (17,460) נספרים בספטמבר במקום להיעלם', () => {
    expect(UNATTRIBUTED_INCOME).toBe(17_460)
    expect(sep.collectedIncome).toBe(TARGETS['2026-09'] + 17_360 + 1_672 + UNATTRIBUTED_INCOME)
  })

  it('ההוצאות הישירות של אותם תיקים (1,585) נכנסות איתם', () => {
    expect(sep.directExpenses).toBe(1_672 + 1_585)
  })

  it('ולכן ספטמבר במערכת = 38,322 ולא 22,447 — הפרש 15,875 שדן וניסים צריכים להכריע עליו', () => {
    expect(sep.distributableProfit).toBe(38_322)
    expect(sep.distributableProfit - TARGETS['2026-09']).toBe(UNATTRIBUTED_INCOME - 1_585)
    expect(sep.closingBalance).toBe(TARGET_CLOSING_BALANCE - (UNATTRIBUTED_INCOME - 1_585) / 2)
  })

  it('יולי ואוגוסט אינם מושפעים', () => {
    expect(full[0]!.distributableProfit).toBe(TARGETS['2026-07'])
    expect(full[1]!.distributableProfit).toBe(TARGETS['2026-08'])
  })

  it('התקבולים האלה מסומנים "לשאול את ניסים" ומתוארכים ליום הייבוא', () => {
    const flagged = transactions.filter((t) => t.nature === 'income' && t.reviewStatus === 'ask_nissim')
    expect(flagged).toHaveLength(3)
    expect(flagged.every((t) => t.dateCash === IMPORT_DATE)).toBe(true)
  })
})

describe('כרטיס ניסים — 8 שורות החישוב (SPEC §3.3)', () => {
  const aug = computeNissimCard(asFileCounted, { ...baseOpts, month: '2026-08', openingBalance: FILE_CARD['2026-07'].balance })

  it('שורה 1: Σ income actual עם deal_id בחודש התקבול', () => { expect(aug.collectedIncome).toBe(123_500) })
  it('שורה 2: רק הוצאות "מוכרות" — הדס (לא) לא נכנסת', () => {
    expect(aug.approvedFixedExpenses).toBe(17_600)
    const hadas = transactions.find((t) => t.categoryId === 'cat:שכר' && t.dateCash.startsWith('2026-08'))!
    expect(hadas.deductible).toBe(false)
    expect(aug.lines[1]!.txIds).not.toContain(hadas.id)
  })
  it('שורה 3: הוצאות ישירות לפי חודש התיק', () => { expect(aug.directExpenses).toBe(18) })
  it('שורה 4: 1 − 2 − 3', () => { expect(aug.distributableProfit).toBe(123_500 - 17_600 - 18) })
  it('שורה 5: 50/50', () => { expect(aug.nissimShare).toBe(52_941); expect(aug.harelShare).toBe(52_941) })
  it('שורה 6: מקדמות החודש', () => { expect(aug.advancesThisMonth).toBe(41_550) })
  it('שורה 7: פתיחה + מקדמות − חלק ניסים', () => { expect(aug.closingBalance).toBe(39_231 + 41_550 - 52_941) })
  it('שורה 8: ניסים חייב → 0; החברה חייבת → העברה', () => {
    expect(aug.transferDueBy10th).toBe(0)
    const owed = computeNissimCard(asFileCounted, { ...baseOpts, month: '2026-08', openingBalance: -100_000 })
    expect(owed.transferDueBy10th).toBe(-owed.closingBalance)
  })

  it('חודש הפסד (יולי): ניסים נושא ב-50% כברירת מחדל; harel_absorbs מאפס', () => {
    const shared = computeNissimCard(asFileCounted, { ...baseOpts, month: '2026-07', openingBalance: 0 })
    expect(shared.nissimShare).toBe(-14_131)
    const absorbed = computeNissimCard(asFileCounted, { ...baseOpts, month: '2026-07', openingBalance: 0, lossSharing: 'harel_absorbs' })
    expect(absorbed.nissimShare).toBe(0)
    expect(absorbed.harelShare).toBe(-28_262)
  })

  it('הוצאה קבועה לא מאושרת — הר-אל סופגת 100%', () => {
    const fx = fixedExpenses.map((f) => (f.id === 'fx-1' ? { ...f, approvedByNissim: false } : f))
    const card = computeNissimCard(asFileCounted, { ...baseOpts, fixedExpenses: fx, month: '2026-08', openingBalance: 0 })
    const excluded = asFileCounted.filter((t) => t.fixedExpenseId === 'fx-1' && t.deductible === true && t.dateCash.startsWith('2026-08')).reduce((a, t) => a + Math.abs(t.amountNet), 0)
    expect(card.approvedFixedExpenses).toBe(17_600 - excluded)
  })

  it('הוצאה משותפת נכנסת רק בחלק המימון (80%)', () => {
    const shared: Transaction = { ...asFileCounted.find((t) => t.nature === 'expense')!, id: 'tx-shared', dateCash: '2026-08-15', amountNet: -1_000, division: 'shared', divisionSplit: DEFAULT_SPLIT, dealId: undefined, fixedExpenseId: undefined, deductible: true }
    const card = computeNissimCard([...asFileCounted, shared], { ...baseOpts, month: '2026-08', openingBalance: 0 })
    expect(card.approvedFixedExpenses).toBe(17_600 + 800)
  })
})

describe('מה שאסור שייכנס לכרטיס (SPEC §1.3, §2.1)', () => {
  const base = asFileCounted.find((t) => t.nature === 'expense')!
  const noise: Transaction[] = [
    { ...base, id: 'n-draw', dateCash: '2026-08-10', amountNet: -12_000, nature: 'draw', dealId: undefined, fixedExpenseId: undefined },
    { ...base, id: 'n-transfer', dateCash: '2026-08-10', amountNet: -50_000, nature: 'transfer', dealId: undefined, fixedExpenseId: undefined },
    { ...base, id: 'n-private', dateCash: '2026-08-10', amountNet: -900, division: 'private', dealId: undefined, fixedExpenseId: undefined },
    { ...base, id: 'n-realestate', dateCash: '2026-08-10', amountNet: 40_000, nature: 'income', division: 'realestate', dealId: 'deal-re', fixedExpenseId: undefined },
    { ...base, id: 'n-expected', dateCash: '2026-08-10', amountNet: 999_999, nature: 'income', certainty: 'expected', dealId: deals[0]!.id, fixedExpenseId: undefined },
    { ...base, id: 'n-nondeductible', dateCash: '2026-08-10', amountNet: -1_500, deductible: false, dealId: undefined, fixedExpenseId: undefined },
  ]
  const clean = computeNissimCard(asFileCounted, { ...baseOpts, month: '2026-08', openingBalance: 0 })
  const noisy = computeNissimCard([...asFileCounted, ...noise], { ...baseOpts, month: '2026-08', openingBalance: 0 })

  it('draw / transfer / private / נדל"ן / expected / לא-מוכרת — כולם לא משנים דבר', () => {
    expect(noisy.distributableProfit).toBe(clean.distributableProfit)
    expect(noisy.collectedIncome).toBe(clean.collectedIncome)
    const ids = new Set(noisy.lines.flatMap((l) => l.txIds))
    for (const n of noise) expect(ids.has(n.id), n.id).toBe(false)
  })
})

describe('שיוך תקבול שני לחודש שבו נכנס (SPEC §3.4, ליקוי #3)', () => {
  // תיק שנסגר באוגוסט ומקבל תקבול נוסף באוקטובר: התקבול נספר באוקטובר, ההוצאה הישירה נשארת באוגוסט.
  const augDeal = deals.find((d) => d.monthAttributed === '2026-08')!
  const second: Transaction = { ...asFileCounted.find((t) => t.nature === 'income')!, id: 'tx-second', dateCash: '2026-10-05', amountNet: 7_000, dealId: augDeal.id }
  const withSecond = [...asFileCounted, second]

  it('אוגוסט לא משתנה; אוקטובר מקבל את התקבול', () => {
    const aug = computeNissimCard(withSecond, { ...baseOpts, month: '2026-08', openingBalance: 0 })
    const oct = computeNissimCard(withSecond, { ...baseOpts, month: '2026-10', openingBalance: 0 })
    expect(aug.collectedIncome).toBe(123_500)
    expect(oct.collectedIncome).toBe(7_000)
    expect(oct.lines[0]!.txIds).toContain('tx-second')
  })
})

describe('חריגים שחוסמים סגירת חודש (SPEC §3.3 שלב 2)', () => {
  it('ספטמבר בקובץ האמיתי חסום: תקבולים "לשאול את ניסים" אינם חריג חוסם, אבל unknown_expense כן', () => {
    const blockers = findClosingBlockers(transactions, { month: '2026-09', deals, advances })
    expect(blockers.some((b) => b.kind === 'unknown_expense')).toBe(false)
    const withUnknown: Transaction[] = [...transactions, { ...transactions[0]!, id: 'tx-unknown', dateCash: '2026-09-10', reviewStatus: 'unknown_expense' }]
    expect(findClosingBlockers(withUnknown, { month: '2026-09', deals, advances }).some((b) => b.kind === 'unknown_expense')).toBe(true)
  })

  it('תיק עם הוצאה ישירה ובלי תקבול ובלי חודש — חוסם', () => {
    const blockers = findClosingBlockers(transactions, { month: '2026-09', deals, advances })
    // בקובץ: תיקים "על בסיס הצלחה" עם נסח (18 ₪) ובלי חודש ובלי תקבול
    expect(blockers.find((b) => b.kind === 'deal_without_month')!.refIds.length).toBeGreaterThan(0)
  })

  it('מקדמה בלי חודש חוסמת', () => {
    const b = findClosingBlockers(transactions, { month: '2026-07', deals, advances: [...advances, { id: 'adv-x', date: '2026-07-01', amountGross: 5_000, method: 'cash', period: '' }] })
    expect(b.some((x) => x.kind === 'advance_without_period')).toBe(true)
  })

  it('בנות אשראי שלא מסתכמות לאב (SPEC §2.1)', () => {
    const p = transactions[0]!
    const parent: Transaction = { ...p, id: 'tx-parent', amountGross: -1_000, amountNet: -1_000, parentId: null }
    const child: Transaction = { ...p, id: 'tx-child', amountGross: -600, amountNet: -600, parentId: 'tx-parent' }
    expect(findCardMismatches([parent, child])).toHaveLength(1)
    expect(findCardMismatches([parent, child, { ...child, id: 'tx-child-2', amountGross: -400, amountNet: -400 }])).toHaveLength(0)
  })
})
