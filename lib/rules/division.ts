/**
 * הפרדת פעילויות — SPEC §1.2.
 *
 * "לכל תנועה, עסקה, הוצאה ומקדמה יש division. `shared` חייב מפתח חלוקה."
 *
 * כל דוח שמסונן לפי פעילות עובר דרך `shareOf` — אין מקום אחר בקוד
 * שמחליט כמה מתנועה משותפת שייך למימון וכמה לנדל"ן.
 */

import { mulMoney, type Shekels } from './money.js'
import type { ConcreteDivision, Division, DivisionSplit, Transaction } from './types.js'

export const CONCRETE_DIVISIONS: readonly ConcreteDivision[] = ['realestate', 'finance']

/** נרמול מפתח חלוקה: משלים חלקים חסרים ומוודא שהסכום 1. */
export function normalizeSplit(split: DivisionSplit): Record<ConcreteDivision, number> {
  const finance = split.finance ?? 0
  const realestate = split.realestate ?? 0
  const total = finance + realestate
  if (total <= 0) {
    throw new RangeError('normalizeSplit: מפתח חלוקה חייב סכום חיובי')
  }
  return { finance: finance / total, realestate: realestate / total }
}

/**
 * איזה חלק מהתנועה שייך לפעילות המבוקשת.
 * - אותה פעילות → 1
 * - `shared` → לפי מפתח החלוקה של השורה, ואם אין — ברירת המחדל מההגדרות
 * - `private` → 0 תמיד (SPEC §2.1: "לא נכנס לשום דוח עסקי")
 */
export function divisionWeight(
  txDivision: Division,
  txSplit: DivisionSplit | undefined,
  target: ConcreteDivision,
  defaultSplit: DivisionSplit,
): number {
  if (txDivision === 'private') return 0
  if (txDivision === target) return 1
  if (txDivision === 'shared') {
    const split = normalizeSplit(txSplit ?? defaultSplit)
    return split[target]
  }
  return 0
}

/** הסכום מתוך `amount` ששייך לפעילות `target`. */
export function shareOf(
  tx: Pick<Transaction, 'division' | 'divisionSplit'>,
  amount: Shekels,
  target: ConcreteDivision,
  defaultSplit: DivisionSplit,
): Shekels {
  const weight = divisionWeight(tx.division, tx.divisionSplit, target, defaultSplit)
  if (weight === 0) return 0
  if (weight === 1) return amount
  return mulMoney(amount, weight)
}

/**
 * האם התנועה נספרת בכלל בדוחות פעילות.
 * SPEC §2.1: שורת-בת של חיוב אשראי (`parentId` מלא) לא נספרת בתזרים —
 * היא קיימת רק לצורך סיווג, והאב הוא שמייצג את הכסף שזז.
 * לדוחות P&L ההיפך נכון: האב הוא סך החיוב, והבנות הן הסיווג —
 * ולכן כל דוח מצהיר מה הוא רוצה דרך `TxScope`.
 */
export type TxScope = 'cash' | 'classified'

/**
 * סינון לפי רמת הפירוט:
 * - `cash` — רק שורות שמייצגות תנועת כסף אמיתית בחשבון (ללא בנות אשראי).
 * - `classified` — רמת הסיווג: הבנות במקום האב שלהן.
 */
export function inScope(tx: Transaction, scope: TxScope, parentIds: ReadonlySet<string>): boolean {
  if (scope === 'cash') return !tx.parentId
  // classified: משמיטים אב שיש לו בנות, ולוקחים את הבנות עצמן
  if (tx.parentId) return true
  return !parentIds.has(tx.id)
}

/** אוסף מזהי האבות שיש להם לפחות בת אחת. */
export function collectParentIds(txs: readonly Transaction[]): Set<string> {
  const parents = new Set<string>()
  for (const tx of txs) {
    if (tx.parentId) parents.add(tx.parentId)
  }
  return parents
}
