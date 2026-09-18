/**
 * תחזית רבעונית — SPEC §3.7.
 *
 *   קצב מכירות     = ממוצע נע 8 שבועות של fee_agreed_net בעסקאות שנחתמו
 *   קצב גביה       = ממוצע נע 8 שבועות של income actual
 *   זמן חתימה→גביה = נמדד מהנתונים
 *
 * פלט: לכל אחד מ-3 החודשים הבאים — צפי חתימות, צפי גביה, צפי הוצאות קבועות,
 * צפי רווח לחלוקה, צפי חלק ניסים — בשלושה תרחישים
 * (פסימי = committed בלבד · בסיס · אופטימי = ×1.2).
 */

import { addMoney, divMoney, mulMoney, round2, subMoney, sumBy, type Shekels } from './money.js'
import { stageProbability } from './probability.js'
import {
  addDays,
  addMonths,
  dayInMonth,
  daysBetween,
  monthOf,
  monthRange,
  type IsoDate,
  type IsoMonth,
} from './period.js'
import type {
  ConcreteDivision,
  Deal,
  DealPaymentPlan,
  FixedExpense,
  Transaction,
} from './types.js'

export type Scenario = 'pessimistic' | 'base' | 'optimistic'

/** SPEC §3.7 — אופטימי = ×1.2. */
export const OPTIMISTIC_FACTOR = 1.2

export interface RunRates {
  /** ₪ לשבוע — שכ"ט שנחתם. */
  weeklySignings: Shekels
  /** ₪ לשבוע — גביה בפועל. */
  weeklyCollections: Shekels
  /** ימים ממוצעים מחתימה לתקבול ראשון. null אם אין מספיק נתונים. */
  avgDaysSignToCollect: number | null
  /** על כמה עסקאות נמדד — כדי שהמסך יוכל להגיד "לפי 6 עסקאות". */
  sampleSize: number
}

/**
 * ממוצע נע 8 שבועות. חלון קצר מכוון: בעסק בקצב הזה, 8 שבועות הוא
 * האיזון בין רעש לבין תגובה לשינוי אמיתי.
 */
export function computeRunRates(
  deals: readonly Deal[],
  txs: readonly Transaction[],
  asOf: IsoDate,
  weeks = 8,
): RunRates {
  const from = addDays(asOf, -weeks * 7)
  const window = (d: string) => d > from && d <= asOf

  const signed = deals.filter((d) => d.signedAt && window(d.signedAt))
  const collections = txs.filter(
    (tx) => tx.nature === 'income' && tx.certainty === 'actual' && window(tx.dateCash),
  )

  const lags: number[] = []
  for (const deal of deals) {
    if (!deal.signedAt) continue
    const first = txs
      .filter((tx) => tx.dealId === deal.id && tx.nature === 'income' && tx.certainty === 'actual')
      .map((tx) => tx.dateCash)
      .sort()[0]
    if (first) lags.push(daysBetween(deal.signedAt, first))
  }

  return {
    weeklySignings: divMoney(sumBy(signed, (d) => d.feeAgreedNet), weeks),
    weeklyCollections: divMoney(sumBy(collections, (tx) => tx.amountNet), weeks),
    avgDaysSignToCollect: lags.length
      ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length)
      : null,
    sampleSize: signed.length,
  }
}

export interface ForecastMonth {
  month: IsoMonth
  scenario: Scenario
  /** צפי חתימות — שכ"ט חדש שייסגר החודש. */
  expectedSignings: Shekels
  /** מהפייפליין הקיים, משוקלל. */
  pipelineCollections: Shekels
  /** מקצב מכירות חדש, אחרי זמן החתימה→גביה. */
  newBusinessCollections: Shekels
  expectedCollections: Shekels
  expectedFixedExpenses: Shekels
  expectedDistributableProfit: Shekels
  expectedNissimShare: Shekels
}

export interface ForecastOptions {
  asOf: IsoDate
  division: ConcreteDivision
  months?: number
  deals: readonly Deal[]
  plans: readonly DealPaymentPlan[]
  fixedExpenses: readonly FixedExpense[]
  nissimSharePct?: number
  stageProbabilities?: Partial<Record<Deal['stage'], number>>
}

export function computeForecast(
  txs: readonly Transaction[],
  opts: ForecastOptions,
): ForecastMonth[] {
  const {
    asOf,
    division,
    months = 3,
    deals,
    plans,
    fixedExpenses,
    nissimSharePct = 0.5,
    stageProbabilities = {},
  } = opts

  const rates = computeRunRates(deals, txs, asOf)
  const dealById = new Map(deals.map((d) => [d.id, d]))
  const out: ForecastMonth[] = []

  for (let i = 1; i <= months; i++) {
    const month = addMonths(monthOf(asOf), i)
    const range = monthRange(month)

    // פייפליין קיים, לפי תרחיש
    const monthPlans = plans.filter(
      (p) => !p.matchedTxId && p.expectedDate >= range.from && p.expectedDate <= range.to,
    )

    const committedOnly = sumBy(
      monthPlans.filter((p) => p.certainty === 'committed'),
      (p) => p.amountNet,
    )
    const weighted = sumBy(monthPlans, (p) => {
      if (p.certainty === 'committed') return p.amountNet
      const deal = dealById.get(p.dealId)
      const prob = deal
        ? stageProbability(
            {
              stage: deal.stage,
              probabilityOverride: p.probability ?? deal.probabilityOverride,
              lastActivityAt: deal.lastActivityAt,
            },
            asOf,
            stageProbabilities,
          ).probability
        : p.probability
      return mulMoney(p.amountNet, prob)
    })

    const fixedForMonth = expectedFixedForMonth(fixedExpenses, month, division)

    // עסקים חדשים: קצב החתימות, מוסט בזמן החתימה→גביה.
    const lagMonths = rates.avgDaysSignToCollect
      ? Math.round(rates.avgDaysSignToCollect / 30)
      : 1
    const signingWeeks = 4.345 // שבועות בחודש ממוצע
    const newSignings = mulMoney(rates.weeklySignings, signingWeeks)
    const newCollections = i > lagMonths ? newSignings : 0

    for (const scenario of ['pessimistic', 'base', 'optimistic'] as const) {
      const pipeline =
        scenario === 'pessimistic' ? committedOnly : scenario === 'base' ? weighted : mulMoney(weighted, OPTIMISTIC_FACTOR)
      const newBiz =
        scenario === 'pessimistic'
          ? 0
          : scenario === 'base'
            ? newCollections
            : mulMoney(newCollections, OPTIMISTIC_FACTOR)
      const signings =
        scenario === 'pessimistic'
          ? 0
          : scenario === 'base'
            ? newSignings
            : mulMoney(newSignings, OPTIMISTIC_FACTOR)

      const collections = addMoney(pipeline, newBiz)
      const profit = subMoney(collections, fixedForMonth)

      out.push({
        month,
        scenario,
        expectedSignings: signings,
        pipelineCollections: pipeline,
        newBusinessCollections: newBiz,
        expectedCollections: collections,
        expectedFixedExpenses: fixedForMonth,
        expectedDistributableProfit: profit,
        expectedNissimShare:
          division === 'finance' ? mulMoney(profit, nissimSharePct) : 0,
      })
    }
  }

  return out
}

/** Σ ההוצאות הקבועות שיתממשו בחודש, בחלק ששייך לפעילות. */
function expectedFixedForMonth(
  fixedExpenses: readonly FixedExpense[],
  month: IsoMonth,
  division: ConcreteDivision,
): Shekels {
  let total = 0
  for (const fixed of fixedExpenses) {
    if (!fixed.active) continue
    const date = dayInMonth(month, fixed.dayOfMonth)
    if (date < fixed.startDate) continue
    if (fixed.endDate && date > fixed.endDate) continue
    if (fixed.frequency === 'once' && month !== fixed.startDate.slice(0, 7)) continue

    const weight =
      fixed.division === division
        ? 1
        : fixed.division === 'shared'
          ? (fixed.divisionSplit?.[division] ?? 0)
          : 0
    if (weight === 0) continue
    total += Math.abs(fixed.amountNet) * weight
  }
  return round2(total)
}
