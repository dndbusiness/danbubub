import { sql } from '@/lib/db'
import { averageRecentAdvances, computeCashflow13w, type CashflowItem, type CashflowResult } from '@/lib/rules/cashflow.js'
import { addDays, addMonths, dayInMonth, monthOf } from '@/lib/rules/period.js'
import { DEFAULT_THRESHOLDS, type AlertThresholds } from '@/lib/rules/alerts.js'
import type { Balance, Deal, DealPaymentPlan, FixedExpense } from '@/lib/rules/types.js'

export interface AnchorRow { id: string; date: string; account_id: string; balance: number; available_credit: number | null; source: string; updated_at: string }

export async function bankAccount(): Promise<{ id: string; name: string } | null> {
  const [r] = await sql<{ id: string; name: string }[]>`
    select id, name from accounts where type = 'bank' and deleted_at is null and active order by created_at limit 1`
  return r ?? null
}

/** העוגן האחרון — SPEC §2.1 balances. */
export async function latestAnchor(accountId: string, onOrBefore?: string): Promise<AnchorRow | null> {
  const [r] = await sql<AnchorRow[]>`
    select id, to_char(date, 'YYYY-MM-DD') as date, account_id, balance, available_credit, source, updated_at::text
    from balances where account_id = ${accountId} and deleted_at is null
      and (${onOrBefore ?? null}::date is null or date <= ${onOrBefore ?? null}::date)
    order by date desc limit 1`
  return r ?? null
}

export async function previousAnchor(accountId: string, before: string): Promise<AnchorRow | null> {
  const [r] = await sql<AnchorRow[]>`
    select id, to_char(date, 'YYYY-MM-DD') as date, account_id, balance, available_credit, source, updated_at::text
    from balances where account_id = ${accountId} and deleted_at is null and date < ${before}
    order by date desc limit 1`
  return r ?? null
}

export async function anchorHistory(accountId: string, days = 30): Promise<AnchorRow[]> {
  return sql<AnchorRow[]>`
    select id, to_char(date, 'YYYY-MM-DD') as date, account_id, balance, available_credit, source, updated_at::text
    from balances where account_id = ${accountId} and deleted_at is null and date >= current_date - ${days}::int
    order by date desc`
}

/** ספי התראות — settings.alert_thresholds מעל ברירות המחדל של ב.11. */
export async function alertThresholds(): Promise<AlertThresholds> {
  const [r] = await sql<{ value: Partial<AlertThresholds> }[]>`select value from settings where key = 'alert_thresholds'`
  return { ...DEFAULT_THRESHOLDS, ...(r?.value && typeof r.value === 'object' ? r.value : {}) }
}

export async function settingValues(keys: string[]): Promise<Record<string, unknown>> {
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from settings where key = any(${keys})`
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export interface CashflowData {
  account: { id: string; name: string }
  anchor: AnchorRow
  result: CashflowResult
  /** כל הפריטים, ממוינים לפי תאריך — ליומן 30 יום ול-drill. */
  items: CashflowItem[]
  expectedAdvance: number
  vatDue: { date: string; amount: number } | null
}

/**
 * חומר הגלם ל-§3.6, מאותם מקורות של v_cashflow_items, והחישוב ב-lib/rules/cashflow.ts.
 * anchorOverride — לסגירת יום: מריצים את התזרים מהעוגן הקודם כדי לדעת מה הוא חזה.
 */
export async function loadCashflow(asOf: string, anchorOverride?: AnchorRow): Promise<CashflowData | { error: string }> {
  const account = await bankAccount()
  if (!account) return { error: 'אין חשבון בנק פעיל' }
  const anchor = anchorOverride ?? (await latestAnchor(account.id, asOf))
  if (!anchor) return { error: 'עדיין לא הוזן עוגן. הזינו את יתרת הבנק כדי לקבל תזרים.' }

  const [plans, deals, fixed, advances, probSetting] = await Promise.all([
    sql<{ id: string; deal_id: string; label: string; amount_net: number; expected_date: string; certainty: 'committed' | 'expected'; probability: number; matched_tx_id: string | null }[]>`
      select id, deal_id, label, amount_net, to_char(expected_date, 'YYYY-MM-DD') as expected_date, certainty, probability, matched_tx_id
      from deal_payments_plan where matched_tx_id is null and deleted_at is null`,
    sql<{ id: string; client_name: string; division: 'finance' | 'realestate'; product: string; stage: string; collection_status: string; fee_agreed_net: number; status: string; probability_override: number | null; last_activity_at: string | null }[]>`
      select id, client_name, division, product, stage, collection_status, fee_agreed_net, status, probability_override,
             to_char(last_activity_at, 'YYYY-MM-DD') as last_activity_at
      from deals where deleted_at is null and status not in ('lost', 'cancelled')`,
    sql<{ id: string; name: string; category_id: string; division: string; division_split: Record<string, number> | null; amount_net: number; vat_mode: string; frequency: string; day_of_month: number; account_id: string; variable: boolean; approved_by_nissim: boolean; start_date: string; end_date: string | null; active: boolean }[]>`
      select id, name, category_id, division, division_split, amount_net, vat_mode, frequency, day_of_month, account_id, variable, approved_by_nissim,
             to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date, active
      from fixed_expenses where deleted_at is null and active`,
    sql<{ id: string; date: string; amount_gross: number; method: 'cash' | 'credit_card' | 'transfer'; period: string }[]>`
      select id, to_char(date, 'YYYY-MM-DD') as date, amount_gross, method, period from advances where deleted_at is null`,
    sql<{ value: Record<string, number> }[]>`select value from settings where key = 'stage_probabilities'`,
  ])

  // מע"מ לתשלום: חבות החודש הקודם, ב-15 לחודש (הנחה — שאלה #27).
  const prevMonth = addMonths(monthOf(asOf), -1)
  const [vat] = await sql<{ liability: number }[]>`select coalesce(sum(liability), 0) as liability from v_vat where vat_month = ${prevMonth}`
  const vatDate = dayInMonth(monthOf(asOf), 15)
  const vatDue = vat && vat.liability > 0 && vatDate >= anchor.date ? { date: vatDate, amount: vat.liability } : null

  const expectedAdvance = averageRecentAdvances(advances.map((a) => ({ id: a.id, date: a.date, amountGross: a.amount_gross, method: a.method, period: a.period })), monthOf(asOf))

  const result = computeCashflow13w({
    anchor: { date: anchor.date, accountId: anchor.account_id, balance: anchor.balance, availableCredit: anchor.available_credit ?? undefined, source: anchor.source as Balance['source'] },
    plans: plans.map((p): DealPaymentPlan => ({ id: p.id, dealId: p.deal_id, label: p.label, amountNet: p.amount_net, expectedDate: p.expected_date, certainty: p.certainty, probability: p.probability, matchedTxId: p.matched_tx_id })),
    deals: deals.map((d): Deal => ({ id: d.id, clientName: d.client_name, division: d.division, product: d.product, stage: d.stage as Deal['stage'], collectionStatus: d.collection_status as Deal['collectionStatus'], feeAgreedNet: d.fee_agreed_net, feeMode: 'fixed', status: d.status as Deal['status'], probabilityOverride: d.probability_override ?? undefined, lastActivityAt: d.last_activity_at ?? undefined })),
    fixedExpenses: fixed.map((f): FixedExpense => ({ id: f.id, name: f.name, categoryId: f.category_id, division: f.division as FixedExpense['division'], divisionSplit: f.division_split ?? undefined, amountNet: f.amount_net, vatMode: f.vat_mode as FixedExpense['vatMode'], frequency: f.frequency as FixedExpense['frequency'], dayOfMonth: f.day_of_month, accountId: f.account_id, variable: f.variable, approvedByNissim: f.approved_by_nissim, startDate: f.start_date, endDate: f.end_date ?? undefined, active: f.active })),
    expectedAdvance,
    taxItems: vatDue ? [{ date: vatDue.date, label: 'מע"מ לתשלום', amount: -vatDue.amount }] : [],
    stageProbabilities: probSetting[0]?.value && typeof probSetting[0].value === 'object' ? (probSetting[0].value as Record<Deal['stage'], number>) : {},
  })
  const items = result.weeks.flatMap((w) => w.items).sort((a, b) => a.date.localeCompare(b.date))
  return { account, anchor, result, items, expectedAdvance, vatDue }
}

/** Σ תנועות בפועל בחשבון בין שני תאריכים (אחרי from, עד to כולל) — הכסף שזז ונרשם. */
export async function recordedBetween(accountId: string, from: string, to: string): Promise<number> {
  const [r] = await sql<{ amount: number }[]>`
    select coalesce(sum(amount_gross), 0) as amount from transactions
    where account_id = ${accountId} and parent_id is null and deleted_at is null and date_cash > ${from} and date_cash <= ${to}`
  return r?.amount ?? 0
}

export interface DailyCloseRow {
  id: string; date: string; account_id: string; previous_anchor_date: string | null; previous_anchor: number | null
  predicted: number; actual: number; recorded: number; variance: number; unexplained: number; exceeds_threshold: boolean
  status: string; note: string | null; resolution_tx_id: string | null
}

export async function dailyCloses(limit = 30): Promise<DailyCloseRow[]> {
  return sql<DailyCloseRow[]>`
    select id, to_char(date, 'YYYY-MM-DD') as date, account_id, to_char(previous_anchor_date, 'YYYY-MM-DD') as previous_anchor_date,
           previous_anchor, predicted, actual, recorded, variance, unexplained, exceeds_threshold, status, note, resolution_tx_id
    from daily_closes where deleted_at is null order by date desc limit ${limit}`
}

/** תנועות בחשבון בין שני עוגנים — ה-drill של "מה נרשם". */
export async function txBetween(accountId: string, from: string | null, to: string) {
  return sql<{ id: string; date_cash: string; description: string | null; counterparty: string | null; amount_gross: number; nature: string }[]>`
    select id, to_char(date_cash, 'YYYY-MM-DD') as date_cash, description, counterparty, amount_gross, nature
    from transactions where account_id = ${accountId} and parent_id is null and deleted_at is null
      and (${from}::date is null or date_cash > ${from}::date) and date_cash <= ${to}
    order by date_cash`
}

export const horizonDays = (from: string, days: number) => ({ from, to: addDays(from, days) })
