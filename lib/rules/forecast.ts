/**
 * תחזית רבעונית — SPEC §3.7 (גרסה 2).
 *
 * "שתי הפעילויות מתנהגות אחרת לגמרי, ולכן לכל אחת מנוע תחזית משלה.
 *  התוצאה מתאחדת רק בשורה אחת — התזרים בחשבון הבנק המשותף."
 *
 *   §3.7.1  נדל"ן   — קצב עסקאות, הכנסה מיידית, עמלת יזם ב-net-30
 *   §3.7.2  מימון   — קצב חתימות לפי מוצר, פריסה לפי התפלגות זמן הגביה
 *   §3.7.3  מאוחד   — תזרים נטו של שתיהן, בלי לספור הוצאות משותפות פעמיים
 *
 * שלושה תרחישים לכל פעילות *בנפרד*, וניתן לשלב (נדל"ן פסימי + מימון בסיס).
 */

import {
  addMoney,
  allocateMoney,
  divMoney,
  mulMoney,
  round2,
  subMoney,
  sumBy,
  type Shekels,
} from './money.js'
import { stageProbability } from './probability.js'
import {
  addDays,
  addMonths,
  dayInMonth,
  daysBetween,
  monthOf,
  monthRange,
  monthsBetween,
  type IsoDate,
  type IsoMonth,
} from './period.js'
import type {
  ConcreteDivision,
  Deal,
  DealPaymentPlan,
  DealStage,
  FixedExpense,
  Transaction,
} from './types.js'

export type Scenario = 'pessimistic' | 'base' | 'optimistic'

export const SCENARIOS: readonly Scenario[] = ['pessimistic', 'base', 'optimistic']

/** SPEC §3.7.3 — אופטימי = קצב × 1.2. */
export const OPTIMISTIC_FACTOR = 1.2

/** §3.7.1 — ממוצע נע 12 שבועות לנדל"ן. */
export const REALESTATE_RATE_WEEKS = 12
/** §3.7.2 — ממוצע נע 8 שבועות למימון. */
export const FINANCE_RATE_WEEKS = 8

const WEEKS_PER_MONTH = 4.345

// ════════════════════════════════════════════════════════════════════════════
// כלים משותפים
// ════════════════════════════════════════════════════════════════════════════

/**
 * מקדם התרחיש על *קצב חדש*. פסימי מאפס עסקים חדשים לגמרי
 * ("committed בלבד, אפס חתימות חדשות"), בסיס = 1, אופטימי = 1.2.
 */
export function newBusinessFactor(scenario: Scenario): number {
  switch (scenario) {
    case 'pessimistic':
      return 0
    case 'base':
      return 1
    case 'optimistic':
      return OPTIMISTIC_FACTOR
  }
}

/** מקדם התרחיש על *פייפליין קיים*. פסימי לוקח committed בלבד — מטופל בנפרד. */
function pipelineFactor(scenario: Scenario): number {
  return scenario === 'optimistic' ? OPTIMISTIC_FACTOR : 1
}

/** ההנחות שמאחורי כל מספר — §3.7.3: "כל הנחה מוצגת ליד המספר וניתנת לדריסה". */
export interface ForecastAssumption {
  key: string
  label: string
  value: number
  unit: 'deals' | 'shekels' | 'weeks' | 'months' | 'pct'
  /** על כמה נתונים נמדד. 0 = אין נתונים, והמסך חייב להגיד זאת (§UIUX 1.3). */
  sampleSize: number
  /** נדרס ידנית בתרחיש "מה אם". */
  overridden?: boolean
}

/** דריסות ידניות לתרחיש "מה אם" (§3.7.3). */
export type AssumptionOverrides = Partial<Record<string, number>>

function assumption(
  a: Omit<ForecastAssumption, 'overridden'>,
  overrides: AssumptionOverrides,
): ForecastAssumption {
  const override = overrides[a.key]
  return override === undefined ? a : { ...a, value: override, overridden: true }
}

// ════════════════════════════════════════════════════════════════════════════
// §3.7.1 — הר-אל השקעות נדל"ן
// ════════════════════════════════════════════════════════════════════════════

export interface RealEstateForecastMonth {
  month: IsoMonth
  scenario: Scenario
  /** עסקאות חדשות צפויות להיחתם החודש. */
  expectedDeals: number
  /** עסקאות × (עמלת אחוזים + דמי פתיחה) — בחודש החתימה. */
  immediateIncome: Shekels
  /** עמלות יזם שמתקבלות החודש — מעסקאות של **החודש הקודם** (net-30). */
  developerCommissions: Shekels
  /** תיקים פתוחים קיימים, משוקללים לפי שלב. */
  pipelineIncome: Shekels
  totalIncome: Shekels
  expenses: Shekels
  distributableProfit: Shekels
  /** חלק לכל שותף — ÷3, בלי לאבד אגורה. */
  partnerShares: Shekels[]
  /** משיכות צפויות: שכר יוני+נדיה, דמי ניהול, החזר חוב. */
  draws: Shekels
  /** מה באמת זז בחשבון: הכנסות − הוצאות − משיכות. */
  netCashFlow: Shekels
  assumptions: ForecastAssumption[]
}

export interface RealEstateForecastOptions {
  asOf: IsoDate
  months?: number
  deals: readonly Deal[]
  plans: readonly DealPaymentPlan[]
  fixedExpenses: readonly FixedExpense[]
  /** מספר השותפים בנדל"ן (3: דן/אביב/יוני). */
  partnerCount?: number
  /** §3.7.1 — ניכוי מס במקור על עמלת היזם. */
  withholdingTaxPct?: number
  /** משיכות קבועות צפויות לחודש: שכר יוני+נדיה בעלות מעביד, דמי ניהול. */
  monthlyDraws?: Shekels
  /** §3.7.1 — החזר חודשי מתוכנן לחוב יוני (מההגדרות). */
  monthlyLoanRepayment?: Shekels
  /** עלויות לידים צפויות לחודש. */
  monthlyLeadCosts?: Shekels
  stageProbabilities?: Partial<Record<DealStage, number>>
  overrides?: AssumptionOverrides
}

/** שלב "חתימת חוזה" בנדל"ן — ממנו נמדד קצב העסקאות (§3.7.1). */
const RE_CONTRACT_STAGES = new Set<DealStage>([
  're_contract_signed',
  're_fee_paid',
  're_developer_commission_received',
  're_closed',
])

export function computeRealEstateForecast(
  txs: readonly Transaction[],
  opts: RealEstateForecastOptions,
): RealEstateForecastMonth[] {
  const {
    asOf,
    months = 3,
    deals,
    plans,
    fixedExpenses,
    partnerCount = 3,
    withholdingTaxPct = 0,
    monthlyDraws = 0,
    monthlyLoanRepayment = 0,
    monthlyLeadCosts = 0,
    stageProbabilities = {},
    overrides = {},
  } = opts

  const reDeals = deals.filter((d) => d.division === 'realestate')
  const windowStart = addDays(asOf, -REALESTATE_RATE_WEEKS * 7)

  // ── קצב עסקאות: ממוצע נע 12 שבועות של חוזי דירה שנחתמו ──────────────────
  const recentContracts = reDeals.filter(
    (d) => d.signedAt && d.signedAt > windowStart && d.signedAt <= asOf && RE_CONTRACT_STAGES.has(d.stage),
  )
  const dealsPerMonth =
    (recentContracts.length / REALESTATE_RATE_WEEKS) * WEEKS_PER_MONTH

  // ── ערך עסקה ממוצע: שני רכיבים בנפרד, כי הם בתזמון שונה ─────────────────
  const immediatePerDeal = recentContracts.length
    ? divMoney(
        sumBy(recentContracts, (d) =>
          addMoney(d.feeAgreedNet ?? 0, d.openingFeeNet ?? 0),
        ),
        recentContracts.length,
      )
    : 0

  const withCommission = recentContracts.filter((d) => (d.developerCommissionNet ?? 0) > 0)
  const developerPerDeal = withCommission.length
    ? divMoney(
        sumBy(withCommission, (d) => d.developerCommissionNet ?? 0),
        withCommission.length,
      )
    : 0

  const baseAssumptions = [
    assumption(
      { key: 're.dealsPerMonth', label: 'עסקאות לחודש', value: round2(dealsPerMonth), unit: 'deals', sampleSize: recentContracts.length },
      overrides,
    ),
    assumption(
      { key: 're.immediatePerDeal', label: 'הכנסה מיידית לעסקה (אחוזים + פתיחה)', value: immediatePerDeal, unit: 'shekels', sampleSize: recentContracts.length },
      overrides,
    ),
    assumption(
      { key: 're.developerPerDeal', label: 'עמלת יזם לעסקה', value: developerPerDeal, unit: 'shekels', sampleSize: withCommission.length },
      overrides,
    ),
    assumption(
      { key: 're.withholdingTaxPct', label: 'ניכוי מס במקור', value: withholdingTaxPct, unit: 'pct', sampleSize: 0 },
      overrides,
    ),
  ]

  const rate = baseAssumptions[0]!.value
  const immediate = baseAssumptions[1]!.value
  const developer = baseAssumptions[2]!.value
  const withholding = baseAssumptions[3]!.value

  const dealById = new Map(reDeals.map((d) => [d.id, d]))
  const out: RealEstateForecastMonth[] = []

  for (const scenario of SCENARIOS) {
    const factor = newBusinessFactor(scenario)
    const expectedDeals = round2(rate * factor)

    for (let i = 1; i <= months; i++) {
      const month = addMonths(monthOf(asOf), i)

      // עמלת היזם מגיעה net-30 — כלומר מעסקאות החודש *הקודם*.
      // בחודש הראשון בתחזית אין עדיין עסקאות חדשות שקדמו לו, ולכן 0
      // (העמלות מעסקאות שכבר נחתמו יושבות בפייפליין הקיים).
      const developerFromPrevious =
        i > 1 ? mulMoney(mulMoney(developer, expectedDeals), 1 - withholding) : 0

      const pipelineIncome = pipelineForMonth(
        plans,
        dealById,
        month,
        asOf,
        scenario,
        stageProbabilities,
      )

      const fixed = expectedFixedForMonth(fixedExpenses, month, 'realestate')
      const expenses = addMoney(fixed, monthlyLeadCosts)
      const immediateIncome = mulMoney(immediate, expectedDeals)
      const totalIncome = addMoney(immediateIncome, developerFromPrevious, pipelineIncome)
      const distributableProfit = subMoney(totalIncome, expenses)
      const draws = addMoney(monthlyDraws, monthlyLoanRepayment)

      out.push({
        month,
        scenario,
        expectedDeals,
        immediateIncome,
        developerCommissions: developerFromPrevious,
        pipelineIncome,
        totalIncome,
        expenses,
        distributableProfit,
        partnerShares: allocateMoney(
          distributableProfit,
          Array.from({ length: partnerCount }, () => 1),
        ),
        draws,
        netCashFlow: subMoney(totalIncome, expenses, draws),
        assumptions: baseAssumptions,
      })
    }
  }

  return out
}

// ════════════════════════════════════════════════════════════════════════════
// §3.7.2 — הר-אל פתרונות מימון
// ════════════════════════════════════════════════════════════════════════════

/**
 * התפלגות זמן חתימה→גביה, במספר חודשי פיגור.
 * §3.7.2: "התחזית פורסת כל חתימה צפויה לפי ההתפלגות, לא לפי ממוצע אחד."
 *
 * המפתח הוא הפיגור בחודשים (0 = נגבה בחודש החתימה), הערך הוא המשקל,
 * וסכום המשקלים 1.
 */
export type LagDistribution = ReadonlyMap<number, number>

/**
 * מודד את ההתפלגות בפועל למוצר נתון.
 * בלי נתונים מחזיר `null` — הקורא מחליט מה לעשות, ולא מקבל ממוצע מומצא.
 */
export function measureLagDistribution(
  deals: readonly Deal[],
  txs: readonly Transaction[],
  product?: string,
): LagDistribution | null {
  const relevant = deals.filter(
    (d) => d.signedAt && (product === undefined || d.product === product),
  )

  const lags: number[] = []
  for (const deal of relevant) {
    const first = txs
      .filter((tx) => tx.dealId === deal.id && tx.nature === 'income' && tx.certainty === 'actual')
      .map((tx) => tx.dateCash)
      .sort()[0]
    if (!first || !deal.signedAt) continue
    lags.push(Math.max(0, Math.round(daysBetween(deal.signedAt, first) / 30)))
  }

  if (!lags.length) return null

  const counts = new Map<number, number>()
  for (const lag of lags) counts.set(lag, (counts.get(lag) ?? 0) + 1)

  const dist = new Map<number, number>()
  for (const [lag, count] of counts) dist.set(lag, count / lags.length)
  return dist
}

export interface FinanceProductRate {
  product: string
  /** חתימות לחודש. */
  signingsPerMonth: number
  /** שכ"ט ממוצע לתיק, נמדד מהנתונים. */
  avgFeeNet: Shekels
  /** מקדמה ממוצעת בחתימה (ברכב: 0). */
  avgAdvanceNet: Shekels
  lagDistribution: LagDistribution | null
  sampleSize: number
}

/** §3.7.2 — קצב חתימות ושכ"ט ממוצע, **לפי מוצר**. */
export function computeFinanceRates(
  deals: readonly Deal[],
  txs: readonly Transaction[],
  asOf: IsoDate,
  weeks = FINANCE_RATE_WEEKS,
): FinanceProductRate[] {
  const finDeals = deals.filter((d) => d.division === 'finance')
  const from = addDays(asOf, -weeks * 7)
  const products = [...new Set(finDeals.map((d) => d.product))]

  return products.map((product) => {
    const all = finDeals.filter((d) => d.product === product)
    const recent = all.filter((d) => d.signedAt && d.signedAt > from && d.signedAt <= asOf)

    return {
      product,
      signingsPerMonth: (recent.length / weeks) * WEEKS_PER_MONTH,
      avgFeeNet: recent.length ? divMoney(sumBy(recent, (d) => d.feeAgreedNet), recent.length) : 0,
      avgAdvanceNet: recent.length
        ? divMoney(sumBy(recent, (d) => d.advanceAtSigningNet ?? 0), recent.length)
        : 0,
      lagDistribution: measureLagDistribution(all, txs, product),
      sampleSize: recent.length,
    }
  })
}

export interface FinanceForecastMonth {
  month: IsoMonth
  scenario: Scenario
  /** חתימות חדשות צפויות. */
  expectedSignings: number
  /** מקדמות בחתימה — מיידיות. */
  signingAdvances: Shekels
  /** מהפייפליין הקיים. */
  pipelineCollections: Shekels
  /** מחתימות חדשות, פרוס לפי התפלגות זמן הגביה. */
  newBusinessCollections: Shekels
  totalCollections: Shekels
  expenses: Shekels
  distributableProfit: Shekels
  nissimShare: Shekels
  harelShare: Shekels
  /** יתרת ניסים המתגלגלת הצפויה בסוף החודש. */
  nissimExpectedBalance: Shekels
  netCashFlow: Shekels
  assumptions: ForecastAssumption[]
}

export interface FinanceForecastOptions {
  asOf: IsoDate
  months?: number
  deals: readonly Deal[]
  plans: readonly DealPaymentPlan[]
  fixedExpenses: readonly FixedExpense[]
  nissimSharePct?: number
  /** יתרת ניסים נוכחית — נקודת הפתיחה לגלגול הצפוי. */
  nissimOpeningBalance?: Shekels
  /** מקדמות צפויות לחודש (ממוצע 3 חודשים, §3.6). */
  expectedMonthlyAdvance?: Shekels
  /** הוצאות ישירות ממוצעות לתיק. */
  avgDirectCostPerDeal?: Shekels
  stageProbabilities?: Partial<Record<DealStage, number>>
  overrides?: AssumptionOverrides
  /** ברירת מחדל כשאין התפלגות נמדדת: כמה חודשים עד הגביה. */
  fallbackLagMonths?: number
}

export function computeFinanceForecast(
  txs: readonly Transaction[],
  opts: FinanceForecastOptions,
): FinanceForecastMonth[] {
  const {
    asOf,
    months = 3,
    deals,
    plans,
    fixedExpenses,
    nissimSharePct = 0.5,
    nissimOpeningBalance = 0,
    expectedMonthlyAdvance = 0,
    avgDirectCostPerDeal = 0,
    stageProbabilities = {},
    overrides = {},
    fallbackLagMonths = 1,
  } = opts

  const rates = computeFinanceRates(deals, txs, asOf)
  const dealById = new Map(deals.map((d) => [d.id, d]))

  const assumptions: ForecastAssumption[] = rates.flatMap((r) => [
    assumption(
      { key: `fin.${r.product}.signingsPerMonth`, label: `חתימות לחודש — ${r.product}`, value: round2(r.signingsPerMonth), unit: 'deals', sampleSize: r.sampleSize },
      overrides,
    ),
    assumption(
      { key: `fin.${r.product}.avgFee`, label: `שכ"ט ממוצע — ${r.product}`, value: r.avgFeeNet, unit: 'shekels', sampleSize: r.sampleSize },
      overrides,
    ),
  ])

  const assumptionValue = (key: string, fallback: number) =>
    assumptions.find((a) => a.key === key)?.value ?? fallback

  const out: FinanceForecastMonth[] = []

  for (const scenario of SCENARIOS) {
    const factor = newBusinessFactor(scenario)
    let nissimBalance = nissimOpeningBalance

    for (let i = 1; i <= months; i++) {
      const month = addMonths(monthOf(asOf), i)

      let expectedSignings = 0
      let signingAdvances: Shekels = 0
      let newBusinessCollections: Shekels = 0

      for (const r of rates) {
        const signingsPerMonth = assumptionValue(
          `fin.${r.product}.signingsPerMonth`,
          r.signingsPerMonth,
        )
        const avgFee = assumptionValue(`fin.${r.product}.avgFee`, r.avgFeeNet)
        const monthlySignings = signingsPerMonth * factor

        expectedSignings += monthlySignings
        signingAdvances = addMoney(
          signingAdvances,
          mulMoney(r.avgAdvanceNet, monthlySignings),
        )

        // פריסת כל חתימה צפויה לפי ההתפלגות (§3.7.2), ולא לפי ממוצע אחד.
        // חתימה בחודש j תורמת לחודש i את המשקל של פיגור (i − j).
        const dist = r.lagDistribution ?? new Map([[fallbackLagMonths, 1]])
        for (let j = 1; j <= i; j++) {
          const weight = dist.get(i - j) ?? 0
          if (weight === 0) continue
          newBusinessCollections = addMoney(
            newBusinessCollections,
            mulMoney(mulMoney(avgFee, monthlySignings), weight),
          )
        }
      }

      const pipelineCollections = pipelineForMonth(
        plans,
        dealById,
        month,
        asOf,
        scenario,
        stageProbabilities,
      )

      const fixed = expectedFixedForMonth(fixedExpenses, month, 'finance')
      const directCosts = mulMoney(avgDirectCostPerDeal, expectedSignings)
      const expenses = addMoney(fixed, directCosts)

      const totalCollections = addMoney(
        pipelineCollections,
        newBusinessCollections,
        signingAdvances,
      )
      const distributableProfit = subMoney(totalCollections, expenses)
      const nissimShare = mulMoney(distributableProfit, nissimSharePct)

      // יתרה מתגלגלת (§3.3 שורה 7): פתיחה + מקדמות − חלק ניסים.
      const advances = scenario === 'pessimistic' ? expectedMonthlyAdvance : expectedMonthlyAdvance
      nissimBalance = subMoney(addMoney(nissimBalance, advances), nissimShare)

      out.push({
        month,
        scenario,
        expectedSignings: round2(expectedSignings),
        signingAdvances,
        pipelineCollections,
        newBusinessCollections,
        totalCollections,
        expenses,
        distributableProfit,
        nissimShare,
        harelShare: subMoney(distributableProfit, nissimShare),
        nissimExpectedBalance: round2(nissimBalance),
        // המקדמה יוצאת מהחשבון בפועל; חלק ניסים מתקזז מולה ולא זז בנפרד.
        netCashFlow: subMoney(totalCollections, expenses, advances),
        assumptions,
      })
    }
  }

  return out
}

// ════════════════════════════════════════════════════════════════════════════
// §3.7.3 — מאוחד
// ════════════════════════════════════════════════════════════════════════════

export interface UnifiedForecastMonth {
  month: IsoMonth
  realEstateScenario: Scenario
  financeScenario: Scenario
  realEstateNet: Shekels
  financeNet: Shekels
  vat: Shekels
  otherDraws: Shekels
  openingBalance: Shekels
  expectedClosingBalance: Shekels
}

export interface UnifiedForecastOptions {
  openingBalance: Shekels
  /** §3.7.3 — אפשר לשלב: נדל"ן פסימי + מימון בסיס. */
  realEstateScenario?: Scenario
  financeScenario?: Scenario
  /** חבות מע"מ צפויה לחודש. */
  vatByMonth?: ReadonlyMap<IsoMonth, Shekels>
  /** משיכות שאינן כבר בתוך תחזית הפעילויות. */
  otherDrawsByMonth?: ReadonlyMap<IsoMonth, Shekels>
}

/**
 * "שורה אחת לחשבון: תזרים נטו נדל"ן + תזרים נטו מימון
 *  − הוצאות משותפות (פעם אחת, לא כפול) − מע"מ − משיכות."
 *
 * ההוצאות המשותפות כבר נמצאות בשתי התחזיות — כל אחת נושאת את *חלקה* לפי
 * מפתח החלוקה (80% מימון / 20% נדל"ן). סכום שני החלקים הוא 100% בדיוק,
 * ולכן חיבור שני התזרימים סופר אותן פעם אחת. `assertNoDoubleCount` מוודא
 * שזה נשאר נכון גם אם מפתח החלוקה ישתנה.
 */
export function computeUnifiedForecast(
  realEstate: readonly RealEstateForecastMonth[],
  finance: readonly FinanceForecastMonth[],
  opts: UnifiedForecastOptions,
): UnifiedForecastMonth[] {
  const {
    openingBalance,
    realEstateScenario = 'base',
    financeScenario = 'base',
    vatByMonth = new Map<IsoMonth, Shekels>(),
    otherDrawsByMonth = new Map<IsoMonth, Shekels>(),
  } = opts

  const re = realEstate.filter((m) => m.scenario === realEstateScenario)
  const fin = finance.filter((m) => m.scenario === financeScenario)
  const months = [...new Set([...re.map((m) => m.month), ...fin.map((m) => m.month)])].sort()

  const out: UnifiedForecastMonth[] = []
  let balance = openingBalance

  for (const month of months) {
    const reNet = re.find((m) => m.month === month)?.netCashFlow ?? 0
    const finNet = fin.find((m) => m.month === month)?.netCashFlow ?? 0
    const vat = vatByMonth.get(month) ?? 0
    const otherDraws = otherDrawsByMonth.get(month) ?? 0

    balance = subMoney(addMoney(balance, reNet, finNet), vat, otherDraws)

    out.push({
      month,
      realEstateScenario,
      financeScenario,
      realEstateNet: reNet,
      financeNet: finNet,
      vat: round2(vat),
      otherDraws: round2(otherDraws),
      openingBalance: round2(subMoney(balance, reNet, finNet) + vat + otherDraws),
      expectedClosingBalance: round2(balance),
    })
  }

  return out
}

/**
 * מוודא שההוצאות המשותפות נספרו פעם אחת בדיוק.
 * מחזיר את ההפרש בין הסכום המלא לבין סכום שני החלקים — אמור להיות 0.
 */
export function sharedExpenseDoubleCount(
  fixedExpenses: readonly FixedExpense[],
  month: IsoMonth,
): Shekels {
  const shared = fixedExpenses.filter((f) => f.division === 'shared' && occursInMonth(f, month))
  const fullAmount = sumBy(shared, (f) => Math.abs(f.amountNet))
  const allocated = addMoney(
    expectedFixedForMonth(shared, month, 'finance'),
    expectedFixedForMonth(shared, month, 'realestate'),
  )
  return subMoney(fullAmount, allocated)
}

// ════════════════════════════════════════════════════════════════════════════
// דיוק התחזית (§3.7.3)
// ════════════════════════════════════════════════════════════════════════════

export interface ForecastSnapshot {
  /** החודש שנחזה. */
  targetMonth: IsoMonth
  /** מתי החיזוי נעשה. */
  forecastedAt: IsoDate
  /** 30 / 60 / 90 — כמה מראש. */
  horizonDays: number
  division: ConcreteDivision | 'unified'
  scenario: Scenario
  predictedCollections: Shekels
  predictedProfit: Shekels
}

export interface ForecastAccuracy {
  targetMonth: IsoMonth
  horizonDays: number
  division: ConcreteDivision | 'unified'
  predicted: Shekels
  actual: Shekels
  variance: Shekels
  /** אחוז דיוק: 100% = מדויק. null כשאין מה לחלק בו. */
  accuracyPct: number | null
}

/**
 * "כל חודש שנסגר, המערכת שומרת מה חזתה 30/60/90 יום קודם מול מה קרה.
 *  מוצג כאחוז — כדי שתדע כמה לסמוך."
 */
export function computeForecastAccuracy(
  snapshots: readonly ForecastSnapshot[],
  actualByMonth: ReadonlyMap<string, Shekels>,
  opts: { metric?: 'collections' | 'profit' } = {},
): ForecastAccuracy[] {
  const metric = opts.metric ?? 'collections'

  return snapshots
    .map((s) => {
      const key = `${s.division}|${s.targetMonth}`
      const actual = actualByMonth.get(key)
      if (actual === undefined) return null

      const predicted = metric === 'profit' ? s.predictedProfit : s.predictedCollections
      const variance = subMoney(actual, predicted)
      const denominator = Math.abs(actual)

      return {
        targetMonth: s.targetMonth,
        horizonDays: s.horizonDays,
        division: s.division,
        predicted,
        actual,
        variance,
        accuracyPct:
          denominator > 0
            ? round2(Math.max(0, 1 - Math.abs(variance) / denominator) * 100)
            : null,
      }
    })
    .filter((a): a is ForecastAccuracy => a !== null)
}

// ════════════════════════════════════════════════════════════════════════════
// עזרים פנימיים
// ════════════════════════════════════════════════════════════════════════════

/** פייפליין קיים לחודש נתון, לפי תרחיש. */
function pipelineForMonth(
  plans: readonly DealPaymentPlan[],
  dealById: ReadonlyMap<string, Deal>,
  month: IsoMonth,
  asOf: IsoDate,
  scenario: Scenario,
  stageProbabilities: Partial<Record<DealStage, number>>,
): Shekels {
  const { from, to } = monthRange(month)
  const relevant = plans.filter(
    (p) => !p.matchedTxId && p.expectedDate >= from && p.expectedDate <= to,
  )

  if (scenario === 'pessimistic') {
    return sumBy(
      relevant.filter((p) => p.certainty === 'committed'),
      (p) => p.amountNet,
    )
  }

  const weighted = sumBy(relevant, (p) => {
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

  return mulMoney(weighted, pipelineFactor(scenario))
}

function occursInMonth(fixed: FixedExpense, month: IsoMonth): boolean {
  if (!fixed.active) return false
  const date = dayInMonth(month, fixed.dayOfMonth)
  if (date < fixed.startDate) return false
  if (fixed.endDate && date > fixed.endDate) return false
  if (fixed.frequency === 'once') return month === fixed.startDate.slice(0, 7)
  if (fixed.frequency === 'quarterly') return monthDelta(fixed.startDate.slice(0, 7), month) % 3 === 0
  if (fixed.frequency === 'yearly') return monthDelta(fixed.startDate.slice(0, 7), month) % 12 === 0
  return true
}

/** Σ ההוצאות הקבועות שיתממשו בחודש, בחלק ששייך לפעילות. */
export function expectedFixedForMonth(
  fixedExpenses: readonly FixedExpense[],
  month: IsoMonth,
  division: ConcreteDivision,
): Shekels {
  let total = 0
  for (const fixed of fixedExpenses) {
    if (!occursInMonth(fixed, month)) continue
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

function monthDelta(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number]
  const [ty, tm] = to.split('-').map(Number) as [number, number]
  return (ty - fy) * 12 + (tm - fm)
}

export { monthsBetween }
