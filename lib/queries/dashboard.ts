import { sql } from '@/lib/db'
import { monthOf, addMonths } from '@/lib/rules/period.js'

/** ADDENDUM ב.8 — קוביית "דורש טיפול": מונים בלבד, כל אחד עם drill. */
export interface AttentionCounts { unknown_tx: number; missing_invoices: number; inbox_pending: number; open_questions: number; overdue_tasks: number; active_alerts: number; open_closes: number }

export async function attentionCounts(): Promise<AttentionCounts> {
  const [r] = await sql<AttentionCounts[]>`
    select
      (select count(*)::int from transactions where review_status <> 'ok' and deleted_at is null) as unknown_tx,
      (select count(*)::int from transactions where nature in ('income','expense') and invoice_status in ('missing','unknown') and deleted_at is null and certainty = 'actual' and date_cash >= current_date - 90) as missing_invoices,
      (select count(*)::int from inbox_candidates where status = 'pending' and deleted_at is null) as inbox_pending,
      (select count(*)::int from questions where status = 'open' and deleted_at is null) as open_questions,
      (select count(*)::int from tasks where status in ('open','in_progress') and due_date < current_date and deleted_at is null) as overdue_tasks,
      (select count(*)::int from v_active_alerts) as active_alerts,
      (select count(*)::int from daily_closes where status = 'open' and deleted_at is null) as open_closes`
  return r ?? { unknown_tx: 0, missing_invoices: 0, inbox_pending: 0, open_questions: 0, overdue_tasks: 0, active_alerts: 0, open_closes: 0 }
}

export interface AlertRow { id: string; kind: string; rule_key: string; severity: string; channels: string[]; title: string; detail: string | null; amount: number | null; snoozed_until: string | null; resolved_at: string | null; created_at: string }

export async function listAlerts(opts: { includeResolved?: boolean } = {}): Promise<AlertRow[]> {
  return sql<AlertRow[]>`
    select id, kind, rule_key, severity, channels, title, detail, amount, to_char(snoozed_until, 'YYYY-MM-DD') as snoozed_until,
           resolved_at::text, created_at::text
    from alerts where deleted_at is null and (${opts.includeResolved ?? false} or resolved_at is null)
    order by resolved_at nulls first, case severity when 'critical' then 0 when 'high' then 1 else 2 end, created_at desc
    limit 200`
}

export async function riskMode(): Promise<{ critical_count: number; is_risk_mode: boolean }> {
  const [r] = await sql<{ critical_count: number; is_risk_mode: boolean }[]>`select critical_count::int, is_risk_mode from v_risk_mode`
  return r ?? { critical_count: 0, is_risk_mode: false }
}

/** ב.8 "גביה וביצוע": פתוח ודאי / פוטנציאלי + 3 התיקים הגדולים ומה חסר. */
export interface CollectionTop { deal_id: string; client_name: string; division: string; open_amount: number; open_committed: number; open_expected: number; next_missing: string | null; days_overdue: number }
export async function collectionsSummary(division: 'finance' | 'realestate' | 'all') {
  const rows = await sql<CollectionTop[]>`
    select c.deal_id, c.client_name, c.division, c.open_amount, c.open_committed, c.open_expected, p.next_missing, c.days_overdue
    from v_collections c
    left join v_execution_pipeline p on p.deal_id = c.deal_id
    where ${division === 'all'} or c.division = ${division === 'all' ? 'finance' : division}
    order by c.open_amount desc`
  return {
    committed: rows.reduce((a, r) => a + r.open_committed, 0),
    expected: rows.reduce((a, r) => a + r.open_expected, 0),
    total: rows.reduce((a, r) => a + r.open_amount, 0),
    top: rows.slice(0, 3),
    all: rows,
  }
}

/** ב.8 "רווח": MTD תפעולי ולחלוקה מול יעד, קו 3 חודשים. */
export async function profitSummary(month: string, division: 'finance' | 'realestate') {
  const months = [addMonths(month, -2), addMonths(month, -1), month]
  const rows = await sql<{ month: string; mode: string; profit: number; income: number }[]>`
    select month, mode, coalesce(profit, 0) as profit, coalesce(income, 0) as income from v_pnl
    where division = ${division} and month = any(${months})`
  const [target] = await sql<{ value: number }[]>`select (value #>> '{}')::numeric as value from settings where key = 'monthly_profit_target'`
  const pick = (m: string, mode: string) => rows.find((r) => r.month === m && r.mode === mode)
  return {
    operational: pick(month, 'operational')?.profit ?? 0,
    distributable: pick(month, 'distributable')?.profit ?? 0,
    income: pick(month, 'operational')?.income ?? 0,
    target: target?.value ?? null,
    series: months.map((m) => ({ month: m, operational: pick(m, 'operational')?.profit ?? 0, distributable: pick(m, 'distributable')?.profit ?? 0 })),
  }
}

/** ב.8 "התחשבנות": יתרת ניסים משוערת MTD, מקדמות החודש, ימים לסגירה (עד ה-10 בחודש הבא). */
export async function settlementSummary(month: string, today: string) {
  const [card] = await sql<{ line7_closing_balance: number; line6_advances: number; line8_transfer_due: number }[]>`
    select line7_closing_balance, line6_advances, line8_transfer_due from v_nissim_card where month = ${month}`
  const [period] = await sql<{ status: string }[]>`
    select status from periods where division = 'finance' and year = ${Number(month.slice(0, 4))} and month = ${Number(month.slice(5, 7))} and deleted_at is null`
  const next = addMonths(month, 1)
  const closeDate = `${next}-10`
  const daysToClose = Math.round((Date.parse(closeDate) - Date.parse(today)) / 86_400_000)
  return { balance: card?.line7_closing_balance ?? null, advances: card?.line6_advances ?? 0, transferDue: card?.line8_transfer_due ?? 0, closed: period?.status === 'closed', daysToClose }
}

/** ב.8 "הוצאות קרובות": מקור fixed_expenses — דרך פריטי התזרים (אותו לוח §3.6). */
export function upcomingFromItems<T extends { date: string; amount: number; kind: string; label: string }>(items: T[], today: string, monthEnd: string) {
  const in7 = items.filter((i) => i.amount < 0 && i.date > today && i.date <= addDaysIso(today, 7))
  const toMonthEnd = items.filter((i) => i.amount < 0 && i.date > today && i.date <= monthEnd)
  const top3 = [...toMonthEnd].sort((a, b) => a.amount - b.amount).slice(0, 3)
  return { in7Total: -in7.reduce((a, i) => a + i.amount, 0), monthTotal: -toMonthEnd.reduce((a, i) => a + i.amount, 0), in7, toMonthEnd, top3 }
}
function addDaysIso(d: string, n: number) { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }

/** ב.8: "נגבה לפי חודש — עמודות actual + קו מה שהיה צפוי" (SPEC §5.1). */
export async function collectedByMonth(division: 'finance' | 'realestate' | 'all', months = 6, asOfMonth: string) {
  const from = addMonths(asOfMonth, -(months - 1))
  const rows = await sql<{ month: string; actual: number; committed: number; expected: number }[]>`
    with m as (select to_char(gs, 'YYYY-MM') as month from generate_series(${from + '-01'}::date, ${asOfMonth + '-01'}::date, interval '1 month') gs)
    select m.month,
      coalesce((select sum(t.amount_net) from v_tx_classified t where t.nature = 'income' and to_char(t.date_cash, 'YYYY-MM') = m.month
                and (${division === 'all'} or t.division = ${division === 'all' ? 'finance' : division})), 0) as actual,
      coalesce((select sum(p.amount_net) from deal_payments_plan p join deals d on d.id = p.deal_id
                where p.matched_tx_id is null and p.deleted_at is null and p.certainty = 'committed' and to_char(p.expected_date, 'YYYY-MM') = m.month
                and (${division === 'all'} or d.division = ${division === 'all' ? 'finance' : division})), 0) as committed,
      coalesce((select sum(p.amount_net * p.probability) from deal_payments_plan p join deals d on d.id = p.deal_id
                where p.matched_tx_id is null and p.deleted_at is null and p.certainty = 'expected' and to_char(p.expected_date, 'YYYY-MM') = m.month
                and (${division === 'all'} or d.division = ${division === 'all' ? 'finance' : division})), 0) as expected
    from m order by m.month`
  return rows
}

export const currentMonth = (today: string) => monthOf(today)
