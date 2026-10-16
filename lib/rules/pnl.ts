/**
 * רווח והפסד — SPEC §3.2. שתי הגדרות, בכוונה.
 *
 * ┌──────────────┬─────────────────────────────┬──────────────────────────────────┐
 * │              │ רווח תפעולי (מה נשאר בקופה) │ רווח לחלוקה (הסכם השותפות)       │
 * ├──────────────┼─────────────────────────────┼──────────────────────────────────┤
 * │ הכנסות       │ כל income actual בתקופה     │ income actual עם deal_id,        │
 * │              │                             │ לפי month_attributed             │
 * │ קבועות       │ הכל                         │ רק deductible ו-approved (מימון) │
 * │ ישירות       │ נכללות                      │ נכללות, לפי חודש התיק            │
 * │ מקדמות/משיכות│ לא                          │ לא                               │
 * │ מימון        │ לא                          │ לא                               │
 * └──────────────┴─────────────────────────────┴──────────────────────────────────┘
 *
 * SPEC §1.3: רק `expense` ו-`income` נכנסים לרווח והפסד. `advance`, `draw`,
 * `transfer`, `financing`, `vat`, `tax` — לעולם לא.
 */

import { absMoney, subMoney, sumBy, type Shekels } from './money.js'
import { collectParentIds, shareOf } from './division.js'
import { dealMonth, receiptMonth } from './attribution.js'
import { inRange, monthOf, monthRange, type DateRange, type IsoMonth } from './period.js'
import type {
  ConcreteDivision,
  Deal,
  DivisionSplit,
  FixedExpense,
  Transaction,
} from './types.js'

export type PnlMode = 'operational' | 'distributable'

export interface PnlLine {
  /** מזהה הקיבוץ — categoryId, dealId או 'uncategorized'. */
  key: string
  label: string
  amount: Shekels
  /** מזהי התנועות שמרכיבות את השורה — SPEC §5: "אין מסך שמציג מספר בלי drill-down". */
  txIds: string[]
}

export interface PnlResult {
  mode: PnlMode
  division: ConcreteDivision
  income: Shekels
  fixedExpenses: Shekels
  directExpenses: Shekels
  otherExpenses: Shekels
  totalExpenses: Shekels
  profit: Shekels
  incomeLines: PnlLine[]
  expenseLines: PnlLine[]
  /** תנועות שהוחרגו ולמה — כדי שאפשר יהיה להסביר כל הפרש בין שתי ההגדרות. */
  excluded: Array<{ txId: string; reason: string }>
}

export interface PnlOptions {
  mode: PnlMode
  division: ConcreteDivision
  defaultSplit: DivisionSplit
  /** לרווח תפעולי: טווח תאריכים. */
  range?: DateRange
  /** לרווח לחלוקה: חודש ההתחשבנות. */
  month?: IsoMonth
  deals?: readonly Deal[]
  fixedExpenses?: readonly FixedExpense[]
  /**
   * SPEC §3.2 — "רק deductible=true ו-approved_by_nissim=true (במימון)".
   * בנדל"ן (§3.5) אין דרישת אישור, רק deductible.
   */
  requireApproval?: boolean
  /** שם תצוגה לקטגוריה, ל-drill-down. */
  categoryLabel?: (categoryId: string | undefined) => string
}

/** SPEC §1.3 — רק שתי הטבעות האלה נכנסות לרווח והפסד. */
const PNL_NATURES = new Set(['income', 'expense'])

export function computePnl(txs: readonly Transaction[], opts: PnlOptions): PnlResult {
  const {
    mode,
    division,
    defaultSplit,
    deals = [],
    fixedExpenses = [],
    requireApproval = mode === 'distributable' && division === 'finance',
  } = opts

  const label = opts.categoryLabel ?? ((id) => id ?? 'ללא קטגוריה')
  const dealById = new Map(deals.map((d) => [d.id, d]))
  const fixedById = new Map(fixedExpenses.map((f) => [f.id, f]))
  const parentIds = collectParentIds(txs)
  const excluded: PnlResult['excluded'] = []

  // רמת הסיווג: הבנות של חיוב אשראי במקום האב, כי שם יושבת הקטגוריה.
  const classified = txs.filter((tx) => (tx.parentId ? true : !parentIds.has(tx.id)))

  const eligible = classified.filter((tx) => {
    if (tx.certainty !== 'actual') {
      excluded.push({ txId: tx.id, reason: 'certainty≠actual — רווח והפסד מציג actual בלבד (§1.5)' })
      return false
    }
    if (!PNL_NATURES.has(tx.nature)) {
      excluded.push({ txId: tx.id, reason: `nature=${tx.nature} — לא נכנס לרווח והפסד (§1.3)` })
      return false
    }
    if (tx.division === 'private') {
      excluded.push({ txId: tx.id, reason: 'division=private — לא נכנס לשום דוח עסקי (§2.1)' })
      return false
    }
    if (shareOf(tx, 1, division, defaultSplit) === 0) return false // פעילות אחרת — לא חריגה
    return true
  })

  const incomeTxs = eligible.filter((tx) => tx.nature === 'income')
  const expenseTxs = eligible.filter((tx) => tx.nature === 'expense')

  const income =
    mode === 'operational'
      ? selectOperationalIncome(incomeTxs, opts, excluded)
      : selectDistributableIncome(incomeTxs, opts, excluded)

  const expenses =
    mode === 'operational'
      ? selectOperationalExpenses(expenseTxs, opts, excluded)
      : selectDistributableExpenses(expenseTxs, opts, dealById, fixedById, requireApproval, excluded)

  // כל הסכומים נלקחים כחלק הפעילות; הוצאות מגיעות כסכום שלילי ומוצגות חיובי.
  const incomeAmount = sumBy(income, (tx) => shareOf(tx, tx.amountNet, division, defaultSplit))
  const expenseAmount = absMoney(
    sumBy(expenses, (tx) => shareOf(tx, tx.amountNet, division, defaultSplit)),
  )

  const fixedPart = absMoney(
    sumBy(
      expenses.filter((tx) => tx.fixedExpenseId),
      (tx) => shareOf(tx, tx.amountNet, division, defaultSplit),
    ),
  )
  const directPart = absMoney(
    sumBy(
      expenses.filter((tx) => !tx.fixedExpenseId && tx.dealId),
      (tx) => shareOf(tx, tx.amountNet, division, defaultSplit),
    ),
  )
  const otherPart = subMoney(expenseAmount, fixedPart, directPart)

  return {
    mode,
    division,
    income: incomeAmount,
    fixedExpenses: fixedPart,
    directExpenses: directPart,
    otherExpenses: otherPart,
    totalExpenses: expenseAmount,
    profit: subMoney(incomeAmount, expenseAmount),
    incomeLines: groupLines(income, division, defaultSplit, (tx) => tx.dealId ?? 'ללא תיק', label),
    expenseLines: groupLines(expenses, division, defaultSplit, (tx) => tx.categoryId ?? 'uncategorized', label),
    excluded,
  }
}

/** רווח תפעולי: כל ההכנסות בפועל בטווח, לפי תאריך הכסף. */
function selectOperationalIncome(
  txs: readonly Transaction[],
  opts: PnlOptions,
  excluded: PnlResult['excluded'],
): Transaction[] {
  const range = requireRange(opts)
  return txs.filter((tx) => {
    if (!inRange(tx.dateCash, range)) {
      excluded.push({ txId: tx.id, reason: 'מחוץ לטווח התאריכים' })
      return false
    }
    return true
  })
}

/** רווח תפעולי: כל ההוצאות בפועל בטווח — כולל לא-מוכרות וכולל לא-מאושרות. */
function selectOperationalExpenses(
  txs: readonly Transaction[],
  opts: PnlOptions,
  excluded: PnlResult['excluded'],
): Transaction[] {
  const range = requireRange(opts)
  return txs.filter((tx) => {
    if (!inRange(tx.dateCash, range)) {
      excluded.push({ txId: tx.id, reason: 'מחוץ לטווח התאריכים' })
      return false
    }
    return true
  })
}

/**
 * רווח לחלוקה — הכנסות: "income actual בתקופה עם deal_id, לפי month_attributed".
 *
 * שילוב §3.2 עם §3.4: התקבול נספר בחודש שבו *הוא* נכנס. `month_attributed`
 * של התיק הוא מה שקושר אליו את ההוצאות הישירות, לא את התקבול.
 */
function selectDistributableIncome(
  txs: readonly Transaction[],
  opts: PnlOptions,
  excluded: PnlResult['excluded'],
): Transaction[] {
  const month = requireMonth(opts)
  return txs.filter((tx) => {
    if (!tx.dealId) {
      excluded.push({ txId: tx.id, reason: 'הכנסה ללא deal_id — לא נכנסת לרווח לחלוקה (§3.2)' })
      return false
    }
    if (receiptMonth(tx) !== month) return false
    return true
  })
}

/**
 * רווח לחלוקה — הוצאות:
 *   • קבועות: רק `deductible` ו(במימון) `approved_by_nissim`, לפי חודש התנועה.
 *   • ישירות: Σ לפי deal_id, לפי **חודש התיק** — לא חודש התנועה.
 *   • משתנות (לא קבועה ולא ישירה): נכללות אם `deductible`.
 */
function selectDistributableExpenses(
  txs: readonly Transaction[],
  opts: PnlOptions,
  dealById: Map<string, Deal>,
  fixedById: Map<string, FixedExpense>,
  requireApproval: boolean,
  excluded: PnlResult['excluded'],
): Transaction[] {
  const month = requireMonth(opts)
  const allTxs = txs

  return txs.filter((tx) => {
    if (tx.deductible === false) {
      excluded.push({ txId: tx.id, reason: 'deductible=false — לא מוכרת לפעילות (§3.2)' })
      return false
    }

    // הוצאה ישירה: משויכת לחודש של התיק, לא לחודש התנועה.
    if (tx.dealId) {
      const deal = dealById.get(tx.dealId)
      if (!deal) {
        excluded.push({ txId: tx.id, reason: `deal_id=${tx.dealId} לא נמצא` })
        return false
      }
      const dm = dealMonth(deal, allTxs)
      if (dm === undefined) {
        excluded.push({ txId: tx.id, reason: 'לתיק אין חודש שיוך — חריג חוסם (§3.3)' })
        return false
      }
      return dm === month
    }

    // הוצאה קבועה: דורשת אישור ניסים בפעילות המימון.
    if (tx.fixedExpenseId) {
      if (requireApproval) {
        const fixed = fixedById.get(tx.fixedExpenseId)
        if (!fixed?.approvedByNissim) {
          excluded.push({
            txId: tx.id,
            reason: 'הוצאה קבועה לא מאושרת — הר-אל סופגת 100% (§3.2, שאלה פתוחה #3)',
          })
          return false
        }
      }
      return monthOf(tx.dateCash) === month
    }

    // הוצאה משתנה שאינה קשורה לתיק ואינה קבועה.
    return monthOf(tx.dateCash) === month
  })
}

function groupLines(
  txs: readonly Transaction[],
  division: ConcreteDivision,
  defaultSplit: DivisionSplit,
  keyOf: (tx: Transaction) => string,
  label: (key: string | undefined) => string,
): PnlLine[] {
  const groups = new Map<string, Transaction[]>()
  for (const tx of txs) {
    const key = keyOf(tx)
    const list = groups.get(key)
    if (list) list.push(tx)
    else groups.set(key, [tx])
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      label: label(key),
      amount: absMoney(sumBy(list, (tx) => shareOf(tx, tx.amountNet, division, defaultSplit))),
      txIds: list.map((tx) => tx.id),
    }))
    .sort((a, b) => b.amount - a.amount)
}

function requireRange(opts: PnlOptions): DateRange {
  if (opts.range) return opts.range
  if (opts.month) return monthRange(opts.month)
  throw new RangeError('computePnl: נדרש range או month')
}

function requireMonth(opts: PnlOptions): IsoMonth {
  if (opts.month) return opts.month
  throw new RangeError('computePnl: רווח לחלוקה דורש month (חודש התחשבנות)')
}
