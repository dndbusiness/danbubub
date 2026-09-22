/**
 * שיוך עסקה לחודש — SPEC §3.4.
 *
 * "ברירת מחדל: החודש שבו נכנס התקבול הראשון (date_cash הראשון).
 *  ניתן לדריסה ידנית. תקבול שני של תיק (יתרה על בסיס הצלחה) — נספר בחודש
 *  שבו הוא נכנס, לא בחודש המקורי של התיק."
 *
 * זהו התיקון לליקוי #3 בנספח ב: "תקבול חלקי נספר כמלא".
 * שתי הקביעות חיות זו לצד זו ואסור לבלבל ביניהן:
 *   • `dealMonth`      — חודש *העסקה*, קובע לאילו הוצאות ישירות היא מתקזזת.
 *   • `receiptMonth`   — חודש *התקבול*, קובע באיזה חודש הכסף נספר כהכנסה.
 */

import { monthOf, type IsoMonth } from './period.js'
import type { Deal, Transaction } from './types.js'

/**
 * חודש ההתחשבנות של תיק.
 * דריסה ידנית (`monthAttributed`) גוברת; אחרת — חודש התקבול הראשון בפועל;
 * אם עוד לא נכנס כסף — `undefined`, וזה בדיוק מה שחוסם סגירת חודש (SPEC §3.3).
 */
export function dealMonth(deal: Deal, txs: readonly Transaction[]): IsoMonth | undefined {
  if (deal.monthAttributed) return deal.monthAttributed
  const firstReceipt = firstReceiptDate(deal.id, txs)
  return firstReceipt ? monthOf(firstReceipt) : undefined
}

/** תאריך התקבול הראשון בפועל על התיק. */
export function firstReceiptDate(dealId: string, txs: readonly Transaction[]): string | undefined {
  const dates = txs
    .filter((tx) => tx.dealId === dealId && tx.nature === 'income' && tx.certainty === 'actual')
    .map((tx) => tx.dateCash)
    .sort()
  return dates[0]
}

/**
 * החודש שבו נספרת *תנועת ההכנסה עצמה*.
 * SPEC §3.4 מפורשות: תקבול שני נספר בחודש שבו נכנס, לא בחודש התיק.
 */
export function receiptMonth(tx: Transaction): IsoMonth {
  return monthOf(tx.dateCash)
}

/**
 * תיקים שיש בהם כסף ואי אפשר לגזור להם חודש — חריג חוסם לסגירת חודש
 * (SPEC §3.3 שלב 2: "תיקים בלי month_attributed שיש בהם כסף").
 * בפועל זה קורה כשיש הוצאה ישירה על תיק שטרם נגבה ממנו דבר — ההוצאה
 * צריכה להתקזז בחודש כלשהו, ובלי תקבול אין ברירת מחדל.
 */
export function dealsWithMoneyButNoMonth(
  deals: readonly Deal[],
  txs: readonly Transaction[],
): Deal[] {
  return deals.filter((deal) => {
    if (deal.monthAttributed) return false
    if (firstReceiptDate(deal.id, txs)) return false // ייגזר אוטומטית
    const hasDirectCosts = txs.some(
      (tx) => tx.dealId === deal.id && tx.nature === 'expense' && tx.certainty === 'actual',
    )
    return hasDirectCosts
  })
}
