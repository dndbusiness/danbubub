import { sql } from '@/lib/db'
import {
  computeFinanceForecast, computeForecastAccuracy, computeRealEstateForecast, computeUnifiedForecast,
  type AssumptionOverrides, type FinanceForecastMonth, type ForecastAccuracy, type RealEstateForecastMonth,
  type Scenario, type UnifiedForecastMonth,
} from '@/lib/rules/forecast.js'
import type { Deal, DealPaymentPlan, FixedExpense, Transaction } from '@/lib/rules/types.js'
import { bankAccount, latestAnchor, settingValues } from './cashflow'

/**
 * מסך 13 — תחזית רבעונית (SPEC §3.7).
 * מנוע אחד לכל פעילות (§3.7.1 נדל"ן, §3.7.2 מימון), מאוחד לחשבון (§3.7.3),
 * ושלושת התרחישים מאותה פונקציה — כדי שלא יהיו שני מנועי תחזית.
 */

const SCENARIOS: Scenario[] = ['pessimistic', 'base', 'optimistic']

export interface ForecastBundle {
  asOf: string
  months: number
  realEstate: RealEstateForecastMonth[]
  finance: FinanceForecastMonth[]
  unified: UnifiedForecastMonth[]
  openingBalance: number
  anchorDate: string | null
  accuracy: ForecastAccuracy[]
  /** נתוני הקלט — כדי שהמסך יוכל להגיד "על כמה זה מבוסס" (§UIUX 1.3). */
  sample: { deals: number; plans: number; txs: number; months: number }
}

async function inputs() {
  const [plans, deals, fixed, txs] = await Promise.all([
    sql<{ id: string; deal_id: string; label: string; amount_net: number; expected_date: string; certainty: 'committed' | 'expected'; probability: number; matched_tx_id: string | null }[]>`
      select id, deal_id, label, amount_net, to_char(expected_date, 'YYYY-MM-DD') as expected_date, certainty, probability, matched_tx_id
      from deal_payments_plan where deleted_at is null`,
    sql<{ id: string; client_name: string; division: 'finance' | 'realestate'; product: string; stage: string; collection_status: string; fee_agreed_net: number; fee_pct: number | null; base_amount: number | null; advance_at_signing_net: number | null; developer_commission_net: number | null; opening_fee_net: number | null; status: string; probability_override: number | null; signed_at: string | null; month_attributed: string | null; last_activity_at: string | null }[]>`
      select id, client_name, division, product, stage, collection_status, fee_agreed_net, fee_pct, base_amount,
             advance_at_signing_net, developer_commission_net, opening_fee_net, status, probability_override,
             to_char(signed_at, 'YYYY-MM-DD') as signed_at, month_attributed,
             to_char(last_activity_at, 'YYYY-MM-DD') as last_activity_at
      from deals where deleted_at is null`,
    sql<{ id: string; name: string; category_id: string; division: string; division_split: Record<string, number> | null; amount_net: number; vat_mode: string; frequency: string; day_of_month: number; account_id: string; variable: boolean; approved_by_nissim: boolean; start_date: string; end_date: string | null; active: boolean }[]>`
      select id, name, category_id, division, division_split, amount_net, vat_mode, frequency, day_of_month, account_id,
             variable, approved_by_nissim, to_char(start_date, 'YYYY-MM-DD') as start_date,
             to_char(end_date, 'YYYY-MM-DD') as end_date, active
      from fixed_expenses where deleted_at is null and active`,
    sql<{ id: string; date_cash: string; date_doc: string | null; account_id: string; amount_net: number; vat_amount: number; amount_gross: number; nature: string; division: string; certainty: string; deal_id: string | null; category_id: string | null; deductible: boolean | null; tx_class: string; invoice_status: string; vat_mode: string; vat_rate: number }[]>`
      select id, to_char(date_cash, 'YYYY-MM-DD') as date_cash, to_char(date_doc, 'YYYY-MM-DD') as date_doc,
             account_id, amount_net, vat_amount, amount_gross, nature, division, certainty, deal_id, category_id,
             deductible, tx_class, invoice_status, vat_mode, vat_rate
      from transactions where deleted_at is null and parent_id is null`,
  ])

  return {
    plans: plans.map((p): DealPaymentPlan => ({
      id: p.id, dealId: p.deal_id, label: p.label, amountNet: Number(p.amount_net),
      expectedDate: p.expected_date, certainty: p.certainty, probability: Number(p.probability),
      matchedTxId: p.matched_tx_id,
    })),
    deals: deals.map((d): Deal => ({
      id: d.id, clientName: d.client_name, division: d.division, product: d.product,
      stage: d.stage as Deal['stage'], collectionStatus: d.collection_status as Deal['collectionStatus'],
      feeAgreedNet: Number(d.fee_agreed_net), feeMode: 'fixed',
      feePct: d.fee_pct === null ? undefined : Number(d.fee_pct),
      baseAmount: d.base_amount === null ? undefined : Number(d.base_amount),
      advanceAtSigningNet: d.advance_at_signing_net === null ? undefined : Number(d.advance_at_signing_net),
      developerCommissionNet: d.developer_commission_net === null ? undefined : Number(d.developer_commission_net),
      openingFeeNet: d.opening_fee_net === null ? undefined : Number(d.opening_fee_net),
      status: d.status as Deal['status'],
      probabilityOverride: d.probability_override === null ? undefined : Number(d.probability_override),
      signedAt: d.signed_at ?? undefined,
      monthAttributed: d.month_attributed ?? undefined,
      lastActivityAt: d.last_activity_at ?? undefined,
    })),
    fixedExpenses: fixed.map((f): FixedExpense => ({
      id: f.id, name: f.name, categoryId: f.category_id, division: f.division as FixedExpense['division'],
      divisionSplit: f.division_split ?? undefined, amountNet: Number(f.amount_net),
      vatMode: f.vat_mode as FixedExpense['vatMode'], frequency: f.frequency as FixedExpense['frequency'],
      dayOfMonth: f.day_of_month, accountId: f.account_id, variable: f.variable,
      approvedByNissim: f.approved_by_nissim, startDate: f.start_date, endDate: f.end_date ?? undefined, active: f.active,
    })),
    txs: txs.map((t): Transaction => ({
      id: t.id, dateCash: t.date_cash, dateDoc: t.date_doc ?? undefined, accountId: t.account_id,
      amountNet: Number(t.amount_net), vatAmount: Number(t.vat_amount), amountGross: Number(t.amount_gross),
      vatMode: t.vat_mode as Transaction['vatMode'], vatRate: Number(t.vat_rate), nature: t.nature as Transaction['nature'],
      division: t.division as Transaction['division'], certainty: t.certainty as Transaction['certainty'],
      dealId: t.deal_id ?? undefined, categoryId: t.category_id ?? undefined,
      deductible: t.deductible ?? undefined, txClass: t.tx_class as Transaction['txClass'],
      invoiceStatus: t.invoice_status as Transaction['invoiceStatus'],
    })),
  }
}

export async function loadForecast(asOf: string, opts: {
  months?: number
  overrides?: AssumptionOverrides
  realEstateScenario?: Scenario
  financeScenario?: Scenario
} = {}): Promise<ForecastBundle> {
  const months = opts.months ?? 3
  const { plans, deals, fixedExpenses, txs } = await inputs()

  const settings = await settingValues([
    'stage_probabilities', 'nissim_share_pct', 'withholding_tax_pct',
    'realestate_monthly_draws', 'realestate_monthly_loan_repayment', 'monthly_lead_costs',
  ])
  const numSetting = (k: string, fallback: number) => {
    const v = settings[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const stageProbabilities = (settings.stage_probabilities && typeof settings.stage_probabilities === 'object'
    ? settings.stage_probabilities : {}) as Partial<Record<Deal['stage'], number>>

  const account = await bankAccount()
  const anchor = account ? await latestAnchor(account.id, asOf) : null
  const openingBalance = anchor ? Number(anchor.balance) : 0

  const realEstate: RealEstateForecastMonth[] = []
  const finance: FinanceForecastMonth[] = []
  for (const scenario of SCENARIOS) {
    realEstate.push(...computeRealEstateForecast(txs, {
      asOf, months, deals, plans, fixedExpenses, stageProbabilities,
      withholdingTaxPct: numSetting('withholding_tax_pct', 0),
      monthlyDraws: numSetting('realestate_monthly_draws', 0),
      monthlyLoanRepayment: numSetting('realestate_monthly_loan_repayment', 0),
      monthlyLeadCosts: numSetting('monthly_lead_costs', 0),
      overrides: opts.overrides,
    }).filter((m) => m.scenario === scenario))
    finance.push(...computeFinanceForecast(txs, {
      asOf, months, deals, plans, fixedExpenses, stageProbabilities,
      nissimSharePct: numSetting('nissim_share_pct', 0.5),
      overrides: opts.overrides,
    }).filter((m) => m.scenario === scenario))
  }

  // מע"מ צפוי לכל חודש — מאותו view של מסך 10.
  const vatRows = await sql<{ month: string; liability: number }[]>`
    select vat_month as month, coalesce(sum(liability), 0) as liability from v_vat group by vat_month`
  const vatByMonth = new Map(vatRows.map((r) => [r.month, Number(r.liability)]))

  const unified = computeUnifiedForecast(realEstate, finance, {
    openingBalance,
    realEstateScenario: opts.realEstateScenario ?? 'base',
    financeScenario: opts.financeScenario ?? 'base',
    vatByMonth,
  })

  return {
    asOf, months, realEstate, finance, unified, openingBalance,
    anchorDate: anchor?.date ?? null,
    accuracy: await forecastAccuracy(),
    sample: {
      deals: deals.length, plans: plans.length, txs: txs.length,
      months: new Set(txs.map((t) => t.dateCash.slice(0, 7))).size,
    },
  }
}

/** §3.7.3 — "מה חזינו 30/60/90 יום קודם מול מה שקרה". */
export async function forecastAccuracy(): Promise<ForecastAccuracy[]> {
  const snaps = await sql<{ target_month: string; forecasted_at: string; horizon_days: number; division: string; scenario: string; predicted_collections: number; predicted_profit: number }[]>`
    select target_month, to_char(forecasted_at, 'YYYY-MM-DD') as forecasted_at, horizon_days, division, scenario,
           predicted_collections, predicted_profit
    from forecast_snapshots where deleted_at is null order by target_month desc limit 120`
  if (!snaps.length) return []

  const actuals = await sql<{ division: string; month: string; collected: number }[]>`
    select division::text, month_cash as month, coalesce(sum(amount_net), 0) as collected
    from v_tx_classified where nature = 'income' and certainty = 'actual' group by division, month_cash`
  const byKey = new Map<string, number>()
  for (const a of actuals) byKey.set(`${a.division}|${a.month}`, Number(a.collected))
  // "unified" = שתי הפעילויות יחד.
  for (const month of new Set(actuals.map((a) => a.month))) {
    const sum = actuals.filter((a) => a.month === month).reduce((acc, a) => acc + Number(a.collected), 0)
    byKey.set(`unified|${month}`, sum)
  }

  return computeForecastAccuracy(
    snaps.map((s) => ({
      targetMonth: s.target_month, forecastedAt: s.forecasted_at, horizonDays: s.horizon_days,
      division: s.division as 'finance' | 'realestate' | 'unified', scenario: s.scenario as Scenario,
      predictedCollections: Number(s.predicted_collections), predictedProfit: Number(s.predicted_profit),
    })),
    byKey,
  )
}
