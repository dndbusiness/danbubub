/**
 * כרטיס ניסים — סגירת חודש בפעילות המימון. SPEC §3.3.
 *
 *   1. הכנסות_נגבו         = Σ income actual, division=finance, month_attributed=M
 *   2. הוצאות_קבועות_מוכרות = Σ expense actual, division∈{finance, shared×split},
 *                              deductible=1, approved=1, period=M
 *   3. הוצאות_ישירות        = Σ expense actual with deal_id, deal.month_attributed=M
 *   4. רווח_לחלוקה          = 1 − 2 − 3
 *   5. חלק_ניסים            = רווח_לחלוקה × 50%
 *      חלק_הר-אל            = היתרה
 *   6. מקדמות_החודש         = Σ advances, period=M
 *   7. יתרת_חוב_סוף_חודש    = יתרה_פתיחה + מקדמות_החודש − חלק_ניסים
 *      חיובי = ניסים חייב לחברה · שלילי = החברה חייבת לניסים
 *   8. העברה_נדרשת_עד_10    = max(0, −יתרת_חוב)
 *
 * הערה מהותית מ-SPEC §3.3: הוצאות קבועות מאושרות *אינן* תנועה מיוחדת.
 * הן יוצאות מחשבון החברה פעם אחת ומקוזזות מהרווח לפני החלוקה — כלומר ניסים
 * נושא ב-50% מהן דרך החלוקה. הדבר היחיד שיורד רק מחלקו הוא `advance`.
 */

import {
  absMoney,
  addMoney,
  mulMoney,
  positivePart,
  round2,
  subMoney,
  sumBy,
  type Shekels,
} from './money.js'
import { shareOf, collectParentIds } from './division.js'
import { dealMonth, receiptMonth } from './attribution.js'
import { monthOf, type IsoMonth } from './period.js'
import type {
  Advance,
  Deal,
  DivisionSplit,
  FixedExpense,
  Transaction,
} from './types.js'

/** SPEC §10 שאלה פתוחה #5 — האם ניסים נושא ב-50% מהפסד. */
export type LossSharing =
  /** ברירת מחדל, כמו בקובץ הקיים: חלק שלילי — החוב של ניסים גדל. */
  | 'shared'
  /** חלופה: בחודש הפסד חלקו 0 והר-אל סופגת. */
  | 'harel_absorbs'

export interface NissimCardOptions {
  month: IsoMonth
  /** יתרת פתיחה מתגלגלת. לחודש הראשון — הזנה ידנית ("מנקים שולחן", §3.3). */
  openingBalance: Shekels
  /** ברירת מחדל 0.5. */
  nissimSharePct?: number
  defaultSplit: DivisionSplit
  deals: readonly Deal[]
  fixedExpenses: readonly FixedExpense[]
  advances: readonly Advance[]
  lossSharing?: LossSharing
}

export interface NissimCardLine {
  line: number
  label: string
  amount: Shekels
  /** SPEC §5: כל מספר ניתן ללחיצה — אלה השורות שמרכיבות אותו. */
  txIds: string[]
}

export interface NissimCard {
  month: IsoMonth
  /** 1 */ collectedIncome: Shekels
  /** 2 */ approvedFixedExpenses: Shekels
  /** 3 */ directExpenses: Shekels
  /** 4 */ distributableProfit: Shekels
  /** 5 */ nissimShare: Shekels
  /** 5 */ harelShare: Shekels
  /** 6 */ advancesThisMonth: Shekels
  /** 7 — חיובי: ניסים חייב לחברה. שלילי: החברה חייבת לניסים. */
  closingBalance: Shekels
  /** 8 */ transferDueBy10th: Shekels
  openingBalance: Shekels
  lines: NissimCardLine[]
}

const DIVISION = 'finance' as const

export function computeNissimCard(
  txs: readonly Transaction[],
  opts: NissimCardOptions,
): NissimCard {
  const {
    month,
    openingBalance,
    nissimSharePct = 0.5,
    defaultSplit,
    deals,
    fixedExpenses,
    advances,
    lossSharing = 'shared',
  } = opts

  const dealById = new Map(deals.map((d) => [d.id, d]))
  const fixedById = new Map(fixedExpenses.map((f) => [f.id, f]))
  const parentIds = collectParentIds(txs)

  // רמת הסיווג: בת של חיוב אשראי נושאת את הקטגוריה, האב נושא את תנועת הכסף.
  const classified = txs.filter(
    (tx) => (tx.parentId ? true : !parentIds.has(tx.id)) && tx.certainty === 'actual',
  )

  const share = (tx: Transaction) => shareOf(tx, tx.amountNet, DIVISION, defaultSplit)

  // ── שורה 1: הכנסות שנגבו ─────────────────────────────────────────────────
  const incomeTxs = classified.filter(
    (tx) =>
      tx.nature === 'income' &&
      tx.division !== 'private' &&
      share(tx) !== 0 &&
      Boolean(tx.dealId) &&
      receiptMonth(tx) === month,
  )
  const collectedIncome = sumBy(incomeTxs, share)

  // ── שורה 2: הוצאות קבועות מוכרות ומאושרות ────────────────────────────────
  const fixedTxs = classified.filter((tx) => {
    if (tx.nature !== 'expense') return false
    if (tx.division === 'private') return false
    if (share(tx) === 0) return false
    if (tx.dealId) return false // ישירה — שורה 3
    if (tx.deductible === false) return false
    if (monthOf(tx.dateCash) !== month) return false
    if (tx.fixedExpenseId) {
      // הוצאה קבועה: נכנסת לחלוקה רק אם מאושרת.
      return fixedById.get(tx.fixedExpenseId)?.approvedByNissim === true
    }
    // הוצאה משתנה מוכרת שאינה קשורה לתיק ואינה רשומה כקבועה.
    return tx.deductible === true
  })
  const approvedFixedExpenses = absMoney(sumBy(fixedTxs, share))

  // ── שורה 3: הוצאות ישירות, לפי חודש התיק ─────────────────────────────────
  const directTxs = classified.filter((tx) => {
    if (tx.nature !== 'expense') return false
    if (!tx.dealId) return false
    if (share(tx) === 0) return false
    if (tx.deductible === false) return false
    const deal = dealById.get(tx.dealId)
    if (!deal) return false
    return dealMonth(deal, txs) === month
  })
  const directExpenses = absMoney(sumBy(directTxs, share))

  // ── שורות 4–5: רווח וחלוקה ────────────────────────────────────────────────
  const distributableProfit = subMoney(collectedIncome, approvedFixedExpenses, directExpenses)

  const nissimShare =
    distributableProfit < 0 && lossSharing === 'harel_absorbs'
      ? 0
      : mulMoney(distributableProfit, nissimSharePct)
  const harelShare = subMoney(distributableProfit, nissimShare)

  // ── שורה 6: מקדמות החודש ─────────────────────────────────────────────────
  const monthAdvances = advances.filter((a) => a.period === month)
  const advancesThisMonth = absMoney(sumBy(monthAdvances, (a) => a.amountGross))

  // ── שורות 7–8: יתרה והעברה ───────────────────────────────────────────────
  const closingBalance = subMoney(addMoney(openingBalance, advancesThisMonth), nissimShare)
  const transferDueBy10th = positivePart(-closingBalance)

  return {
    month,
    collectedIncome,
    approvedFixedExpenses,
    directExpenses,
    distributableProfit,
    nissimShare,
    harelShare,
    advancesThisMonth,
    closingBalance: round2(closingBalance),
    transferDueBy10th,
    openingBalance: round2(openingBalance),
    lines: [
      { line: 1, label: 'הכנסות שנגבו', amount: collectedIncome, txIds: incomeTxs.map((t) => t.id) },
      { line: 2, label: 'הוצאות קבועות מוכרות', amount: approvedFixedExpenses, txIds: fixedTxs.map((t) => t.id) },
      { line: 3, label: 'הוצאות ישירות', amount: directExpenses, txIds: directTxs.map((t) => t.id) },
      { line: 4, label: 'רווח לחלוקה', amount: distributableProfit, txIds: [] },
      { line: 5, label: 'חלק ניסים', amount: nissimShare, txIds: [] },
      { line: 6, label: 'מקדמות החודש', amount: advancesThisMonth, txIds: monthAdvances.map((a) => a.txId ?? a.id) },
      { line: 7, label: 'יתרת חוב סוף חודש', amount: round2(closingBalance), txIds: [] },
      { line: 8, label: 'העברה נדרשת עד ה-10', amount: transferDueBy10th, txIds: [] },
    ],
  }
}

/**
 * סדרת חודשים רצופה — היתרה מתגלגלת מחודש לחודש.
 * זו הצורה שבה המסך מציג את הכרטיס, וזו גם צורת הבדיקה מול הקובץ הקיים.
 */
export function computeNissimCardSeries(
  txs: readonly Transaction[],
  months: readonly IsoMonth[],
  opts: Omit<NissimCardOptions, 'month' | 'openingBalance'> & { openingBalance: Shekels },
): NissimCard[] {
  const cards: NissimCard[] = []
  let balance = opts.openingBalance
  for (const month of months) {
    const card = computeNissimCard(txs, { ...opts, month, openingBalance: balance })
    cards.push(card)
    balance = card.closingBalance
  }
  return cards
}

// ── חריגים שחוסמים סגירה (SPEC §3.3 שלב 2) ────────────────────────────────

export interface ClosingBlocker {
  kind:
    | 'unknown_expense'
    | 'deal_without_month'
    | 'advance_without_period'
    | 'card_children_mismatch'
  label: string
  refIds: string[]
}

/**
 * רשימת החריגים שחוסמים סגירת חודש:
 * תנועות `unknown_expense`, תיקים בלי חודש שיש בהם כסף, מקדמות בלי חודש,
 * ובנות אשראי שלא מסתכמות לאב.
 */
export function findClosingBlockers(
  txs: readonly Transaction[],
  opts: { month: IsoMonth; deals: readonly Deal[]; advances: readonly Advance[] },
): ClosingBlocker[] {
  const blockers: ClosingBlocker[] = []

  const unknown = txs.filter(
    (tx) => tx.reviewStatus === 'unknown_expense' && monthOf(tx.dateCash) === opts.month,
  )
  if (unknown.length) {
    blockers.push({
      kind: 'unknown_expense',
      label: `${unknown.length} תנועות לא מזוהות`,
      refIds: unknown.map((t) => t.id),
    })
  }

  const noMonth = opts.deals.filter((deal) => {
    if (deal.monthAttributed) return false
    const hasMoney = txs.some((tx) => tx.dealId === deal.id && tx.certainty === 'actual')
    if (!hasMoney) return false
    return dealMonth(deal, txs) === undefined
  })
  if (noMonth.length) {
    blockers.push({
      kind: 'deal_without_month',
      label: `${noMonth.length} תיקים עם כסף ובלי חודש שיוך`,
      refIds: noMonth.map((d) => d.id),
    })
  }

  const noPeriod = opts.advances.filter((a) => !a.period)
  if (noPeriod.length) {
    blockers.push({
      kind: 'advance_without_period',
      label: `${noPeriod.length} מקדמות בלי חודש קיזוז`,
      refIds: noPeriod.map((a) => a.id),
    })
  }

  blockers.push(...findCardMismatches(txs, opts.month))
  return blockers
}

/**
 * SPEC §2.1: "סכום הבנות = סכום האב (בדיקה אוטומטית, אזהרה בסטייה)".
 */
export function findCardMismatches(
  txs: readonly Transaction[],
  month?: IsoMonth,
): ClosingBlocker[] {
  const childrenByParent = new Map<string, Transaction[]>()
  for (const tx of txs) {
    if (!tx.parentId) continue
    const list = childrenByParent.get(tx.parentId)
    if (list) list.push(tx)
    else childrenByParent.set(tx.parentId, [tx])
  }

  const out: ClosingBlocker[] = []
  for (const parent of txs) {
    const children = childrenByParent.get(parent.id)
    if (!children?.length) continue
    if (month && monthOf(parent.dateCash) !== month) continue
    const childSum = sumBy(children, (c) => c.amountGross)
    if (Math.abs(childSum - parent.amountGross) >= 0.01) {
      out.push({
        kind: 'card_children_mismatch',
        label: `חיוב אשראי ${parent.id}: בנות ${childSum} ≠ אב ${parent.amountGross}`,
        refIds: [parent.id, ...children.map((c) => c.id)],
      })
    }
  }
  return out
}
