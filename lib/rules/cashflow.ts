/**
 * תזרים 13 שבועות — SPEC §3.6.
 *
 *   יתרה_צפויה(T) = עוגן_אחרון
 *                 + Σ deal_payments_plan committed עד T
 *                 − Σ fixed_expenses (expected) עד T
 *                 − Σ advances צפויות
 *                 − חובות מע"מ/מס צפויים
 *                 [+ Σ deal_payments_plan expected × probability]   ← קו שני
 *
 * שני קווים, לא אחד: `committed` בלבד, ומעליו committed + expected משוקלל.
 * זה מה ש-WISE לא מבחין בו (SPEC §5.1) וזה מה שמונע "צפי" שמתנהג כוודאות.
 */

import { addMoney, mulMoney, round2, subMoney, sumBy, type Shekels } from './money.js'
import { stageProbability } from './probability.js'
import {
  addDays,
  dayInMonth,
  inRange,
  monthOf,
  weekStart,
  type IsoDate,
} from './period.js'
import type {
  Advance,
  Balance,
  Deal,
  DealPaymentPlan,
  FixedExpense,
  Transaction,
} from './types.js'

export interface CashflowItem {
  date: IsoDate
  label: string
  amount: Shekels // חתום: חיובי נכנס, שלילי יוצא
  certainty: 'committed' | 'expected'
  probability: number
  kind: 'receipt' | 'fixed_expense' | 'advance' | 'vat' | 'tax'
  refId?: string
}

export interface CashflowWeek {
  weekStart: IsoDate
  weekEnd: IsoDate
  /** תנועות ודאיות בלבד. */
  committedIn: Shekels
  committedOut: Shekels
  /** צפי משוקלל בהסתברות. */
  expectedIn: Shekels
  expectedOut: Shekels
  /** יתרה בסוף השבוע — קו 1: committed בלבד. */
  balanceCommitted: Shekels
  /** יתרה בסוף השבוע — קו 2: committed + expected×הסתברות. */
  balanceWeighted: Shekels
  items: CashflowItem[]
}

export interface CashflowResult {
  anchorDate: IsoDate
  anchorBalance: Shekels
  weeks: CashflowWeek[]
  /** SPEC §5 מסך 1 — "נקודה נמוכה ב-90 יום". */
  lowPoint: { date: IsoDate; balance: Shekels } | null
  /** SPEC §3.6 — התראה: יתרה צפויה שלילית, עם תאריך. */
  firstNegativeWeek: IsoDate | null
}

export interface CashflowOptions {
  /** העוגן: היתרה האחרונה שהוזנה ידנית או יובאה. */
  anchor: Balance
  weeks?: number
  plans: readonly DealPaymentPlan[]
  deals: readonly Deal[]
  fixedExpenses: readonly FixedExpense[]
  /** מקדמות צפויות — ברירת מחדל: ממוצע 3 חודשים אחרונים, ביום `advanceDayOfMonth`. */
  expectedAdvance?: Shekels
  advanceDayOfMonth?: number
  /** חובות מע"מ/מס צפויים. */
  taxItems?: readonly { date: IsoDate; label: string; amount: Shekels }[]
  stageProbabilities?: Partial<Record<Deal['stage'], number>>
}

export function computeCashflow13w(opts: CashflowOptions): CashflowResult {
  const {
    anchor,
    weeks: weekCount = 13,
    plans,
    deals,
    fixedExpenses,
    expectedAdvance = 0,
    advanceDayOfMonth = 19,
    taxItems = [],
    stageProbabilities = {},
  } = opts

  const start = weekStart(anchor.date)
  const horizonEnd = addDays(start, weekCount * 7 - 1)
  const window = { from: anchor.date, to: horizonEnd }
  const dealById = new Map(deals.map((d) => [d.id, d]))

  const items: CashflowItem[] = []

  // ── תקבולים צפויים מתיקים ────────────────────────────────────────────────
  for (const plan of plans) {
    if (plan.matchedTxId) continue // כבר נכנס בפועל — מיוצג בעוגן
    if (!inRange(plan.expectedDate, window)) continue
    const deal = dealById.get(plan.dealId)
    const probability =
      plan.certainty === 'committed'
        ? 1
        : deal
          ? stageProbability(
              {
                stage: deal.stage,
                probabilityOverride: plan.probability ?? deal.probabilityOverride,
                lastActivityAt: deal.lastActivityAt,
              },
              anchor.date,
              stageProbabilities,
            ).probability
          : plan.probability
    items.push({
      date: plan.expectedDate,
      label: `${deal?.clientName ?? plan.dealId} — ${plan.label}`,
      amount: plan.amountNet,
      certainty: plan.certainty,
      probability,
      kind: 'receipt',
      refId: plan.id,
    })
  }

  // ── הוצאות קבועות ────────────────────────────────────────────────────────
  for (const fixed of fixedExpenses) {
    for (const date of occurrences(fixed, window)) {
      items.push({
        date,
        label: fixed.name,
        amount: -Math.abs(fixed.amountNet),
        certainty: 'committed',
        probability: 1,
        kind: 'fixed_expense',
        refId: fixed.id,
      })
    }
  }

  // ── מקדמות צפויות לניסים ─────────────────────────────────────────────────
  if (expectedAdvance > 0) {
    for (const month of monthsInWindow(window.from, window.to)) {
      const date = dayInMonth(month, advanceDayOfMonth)
      if (!inRange(date, window)) continue
      items.push({
        date,
        label: 'מקדמה צפויה — ניסים',
        amount: -Math.abs(expectedAdvance),
        certainty: 'expected',
        probability: 1, // הסכום עצמו הוא הממוצע; אי-הוודאות בגובה, לא בקרות
        kind: 'advance',
      })
    }
  }

  // ── מע"מ ומסים ───────────────────────────────────────────────────────────
  for (const tax of taxItems) {
    if (!inRange(tax.date, window)) continue
    items.push({
      date: tax.date,
      label: tax.label,
      amount: -Math.abs(tax.amount),
      certainty: 'committed',
      probability: 1,
      kind: 'vat',
    })
  }

  // ── בנייה שבועית ─────────────────────────────────────────────────────────
  const weeks: CashflowWeek[] = []
  let balanceCommitted = anchor.balance
  let balanceWeighted = anchor.balance

  for (let w = 0; w < weekCount; w++) {
    const ws = addDays(start, w * 7)
    const we = addDays(ws, 6)
    const weekItems = items.filter((it) => it.date >= ws && it.date <= we)

    const committed = weekItems.filter((it) => it.certainty === 'committed')
    const expected = weekItems.filter((it) => it.certainty === 'expected')

    const committedIn = sumBy(committed.filter((i) => i.amount > 0), (i) => i.amount)
    const committedOut = sumBy(committed.filter((i) => i.amount < 0), (i) => i.amount)
    const expectedIn = sumBy(
      expected.filter((i) => i.amount > 0),
      (i) => mulMoney(i.amount, i.probability),
    )
    const expectedOut = sumBy(
      expected.filter((i) => i.amount < 0),
      (i) => mulMoney(i.amount, i.probability),
    )

    balanceCommitted = addMoney(balanceCommitted, committedIn, committedOut)
    balanceWeighted = addMoney(balanceWeighted, committedIn, committedOut, expectedIn, expectedOut)

    weeks.push({
      weekStart: ws,
      weekEnd: we,
      committedIn,
      committedOut,
      expectedIn,
      expectedOut,
      balanceCommitted: round2(balanceCommitted),
      balanceWeighted: round2(balanceWeighted),
      items: weekItems.sort((a, b) => (a.date < b.date ? -1 : 1)),
    })
  }

  const lowWeek = weeks.reduce<CashflowWeek | null>(
    (min, w) => (min === null || w.balanceCommitted < min.balanceCommitted ? w : min),
    null,
  )
  const negative = weeks.find((w) => w.balanceCommitted < 0)

  return {
    anchorDate: anchor.date,
    anchorBalance: round2(anchor.balance),
    weeks,
    lowPoint: lowWeek ? { date: lowWeek.weekEnd, balance: lowWeek.balanceCommitted } : null,
    firstNegativeWeek: negative?.weekEnd ?? null,
  }
}

/** תאריכי המימוש של הוצאה קבועה בתוך חלון התזרים. */
function occurrences(fixed: FixedExpense, window: { from: IsoDate; to: IsoDate }): IsoDate[] {
  if (!fixed.active) return []
  const out: IsoDate[] = []
  for (const month of monthsInWindow(window.from, window.to)) {
    if (!matchesFrequency(fixed, month)) continue
    const date = dayInMonth(month, fixed.dayOfMonth)
    if (date < fixed.startDate) continue
    if (fixed.endDate && date > fixed.endDate) continue
    if (!inRange(date, window)) continue
    out.push(date)
  }
  return out
}

function matchesFrequency(fixed: FixedExpense, month: string): boolean {
  const startMonth = fixed.startDate.slice(0, 7)
  switch (fixed.frequency) {
    case 'monthly':
      return true
    case 'quarterly':
      return monthDelta(startMonth, month) % 3 === 0
    case 'yearly':
      return monthDelta(startMonth, month) % 12 === 0
    case 'once':
      return month === startMonth
  }
}

function monthDelta(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number]
  const [ty, tm] = to.split('-').map(Number) as [number, number]
  return (ty - fy) * 12 + (tm - fm)
}

function monthsInWindow(from: IsoDate, to: IsoDate): string[] {
  const out: string[] = []
  let cursor = monthOf(from)
  const last = monthOf(to)
  while (cursor <= last) {
    out.push(cursor)
    const [y, m] = cursor.split('-').map(Number) as [number, number]
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    cursor = next
  }
  return out
}

// ── סגירת יום (SPEC §3.6) ──────────────────────────────────────────────────

export interface DailyCloseResult {
  date: IsoDate
  /** מה התזרים חזה לאתמול. */
  predicted: Shekels
  /** העוגן שהוזן היום. */
  actual: Shekels
  variance: Shekels
  /** SPEC §3.6 — התראה בסטייה מעל סף. */
  exceedsThreshold: boolean
}

/**
 * "צפי אתמול − עוגן היום = סטייה → תור 'מה קרה?'".
 */
export function computeDailyClose(
  predicted: Shekels,
  actual: Shekels,
  date: IsoDate,
  threshold: Shekels,
): DailyCloseResult {
  const variance = subMoney(actual, predicted)
  return {
    date,
    predicted: round2(predicted),
    actual: round2(actual),
    variance,
    exceedsThreshold: Math.abs(variance) > Math.abs(threshold),
  }
}

export interface DayCloseInput {
  date: IsoDate
  /** העוגן הקודם; null = העוגן הראשון במערכת (אין מה לסגור). */
  previousAnchor: Shekels | null
  previousAnchorDate?: IsoDate | null
  /** העוגן שהוזן היום. */
  actual: Shekels
  /** Σ פריטים ודאיים מהלוח (§3.6) שהיו אמורים להתממש בין העוגנים. */
  committedBetween: Shekels
  /** Σ תנועות בפועל שנרשמו במערכת בין העוגנים (v_tx_cash). */
  recordedBetween: Shekels
  threshold: Shekels
}

export interface DayCloseResult extends DailyCloseResult {
  previousAnchor: Shekels | null
  recorded: Shekels
  /** actual − (previousAnchor + recorded): כסף שזז ואף אחד לא רשם — זה מה שנכנס לתור "מה קרה?". */
  unexplained: Shekels
  /** ok = אין מה לברר; open = נכנס לתור. */
  status: 'ok' | 'open'
}

/**
 * סגירת יום מלאה: הסטייה מול הצפי (ההתראה של §3.6) ובנפרד מה שלא מוסבר
 * ע"י תנועות שנרשמו (התור). שני המספרים נשמרים כי הם עונים על שאלות שונות:
 * "התזרים טעה?" מול "מישהו שכח לרשום?".
 */
export function closeDay(input: DayCloseInput): DayCloseResult {
  const prev = input.previousAnchor
  if (prev === null) {
    return {
      date: input.date, predicted: round2(input.actual), actual: round2(input.actual), variance: 0,
      exceedsThreshold: false, previousAnchor: null, recorded: round2(input.recordedBetween), unexplained: 0, status: 'ok',
    }
  }
  const base = computeDailyClose(addMoney(prev, input.committedBetween), input.actual, input.date, input.threshold)
  const unexplained = subMoney(input.actual, addMoney(prev, input.recordedBetween))
  const open = base.exceedsThreshold || Math.abs(unexplained) > Math.abs(input.threshold)
  return { ...base, previousAnchor: round2(prev), recorded: round2(input.recordedBetween), unexplained, status: open ? 'open' : 'ok' }
}

/**
 * SPEC §3.6 — "עוגן לא עודכן 48 שעות".
 */
export function isAnchorStale(lastAnchor: IsoDate, asOf: IsoDate, maxDays = 2): boolean {
  return lastAnchor < addDays(asOf, -maxDays)
}

/**
 * מקדמה צפויה: ממוצע 3 החודשים האחרונים (SPEC §3.6).
 */
export function averageRecentAdvances(
  advances: readonly Advance[],
  asOfMonth: string,
  months = 3,
): Shekels {
  const window: string[] = []
  let cursor = asOfMonth
  for (let i = 0; i < months; i++) {
    const [y, m] = cursor.split('-').map(Number) as [number, number]
    cursor = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    window.push(cursor)
  }
  const relevant = advances.filter((a) => window.includes(a.period))
  if (!relevant.length) return 0
  return round2(sumBy(relevant, (a) => Math.abs(a.amountGross)) / months)
}

/** תנועות בפועל שכבר נרשמו — לא נספרות שוב בתזרים מעבר לעוגן. */
export function excludeSettled(
  plans: readonly DealPaymentPlan[],
  txs: readonly Transaction[],
): DealPaymentPlan[] {
  const matched = new Set(txs.map((tx) => tx.id))
  return plans.filter((p) => !p.matchedTxId || !matched.has(p.matchedTxId))
}
