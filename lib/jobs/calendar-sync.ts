import { createHash } from 'node:crypto'
import { sql } from '@/lib/db'
import { eventFingerprint, planCalendarEvents, type CalendarEvent } from '@/lib/rules/calendar-events'
import { averageRecentAdvances } from '@/lib/rules/cashflow'
import { addDays, addMonths, monthOf } from '@/lib/rules/period'
import { bankAccount, latestAnchor, settingValues } from '@/lib/queries/cashflow'
import { closingBlockers } from '@/lib/queries/nissim'
import { googleIntegration, hasScope } from '@/lib/google/store'
import { enqueueOutbox, flushOutbox } from './outbox'
import { runJob } from './run'

export interface CalendarPayload { event: CalendarEvent; fingerprint: string; calendarIds: string[] }

/**
 * חלק ג' `calendar_sync` (07:00 יומי) — ADDENDUM ב.2: יצירה/עדכון אירועים ל-60 יום.
 * הכתיבה ליומן עוברת דרך outbox (הנחיה 16) — שורה לאירוע, dedup לפי rule_key + תוכן.
 */
export async function calendarSyncJob(asOf: string): Promise<{ rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }> {
  return runJob('calendar_sync', async () => {
    const integ = await googleIntegration()
    const canWrite = hasScope(integ, 'https://www.googleapis.com/auth/calendar.events')
    const s = await settingValues(['calendar_ids', 'notify_email_dan', 'notify_email_nissim', 'notify_email_hadas', 'payroll_pay_day', 'payroll_approval_day', 'accountant_close_day', 'vat_day', 'vat_bimonthly'])
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v ? Number(v) : undefined)
    const calendarIds = Array.isArray(s.calendar_ids) && s.calendar_ids.length ? (s.calendar_ids as string[]) : ['primary']
    const month = monthOf(asOf)
    const months = [addMonths(month, -1), month, addMonths(month, 1), addMonths(month, 2)]

    const [card, advances, payroll, checklist, vat, cards, receipts, decayed, anchor] = await Promise.all([
      sql<{ month: string; line8_transfer_due: number }[]>`select month, line8_transfer_due from v_nissim_card where month = ${addMonths(month, -1)}`,
      sql<{ id: string; date: string; amount_gross: number; method: 'cash' | 'credit_card' | 'transfer'; period: string }[]>`select id, to_char(date,'YYYY-MM-DD') as date, amount_gross, method, period from advances where deleted_at is null`,
      sql<{ period: string; name: string; status: string; employer_cost_est: number | null; gross_total: number | null }[]>`
        select p.period, e.name, p.status, p.employer_cost_est, p.gross_total from payroll_months p join employees e on e.id = p.employee_id where p.deleted_at is null and p.period = any(${months})`,
      sql<{ period: string; label: string; is_done: boolean }[]>`select period, label, is_done from month_close_checklist where deleted_at is null and period = any(${months}) order by period, created_at`,
      sql<{ vat_month: string; liability: number }[]>`select vat_month, coalesce(sum(liability), 0) as liability from v_vat where vat_month = any(${months}) group by 1`,
      sql<{ id: string; name: string; billing_day: number; expected: number; details: string[] }[]>`
        select a.id, a.name, a.billing_day,
               coalesce((select sum(abs(f.amount_net)) from fixed_expenses f where f.account_id = a.id and f.active and f.deleted_at is null and f.frequency = 'monthly'), 0) as expected,
               coalesce((select array_agg(f.name || ' ' || abs(f.amount_net)::text) from fixed_expenses f where f.account_id = a.id and f.active and f.deleted_at is null), '{}') as details
        from accounts a where a.type = 'credit_card' and a.billing_day is not null and a.active and a.deleted_at is null`,
      sql<{ id: string; date: string; client: string; amount: number; next_missing: string | null }[]>`
        select p.id, to_char(p.expected_date, 'YYYY-MM-DD') as date, d.client_name as client, p.amount_net as amount, x.next_missing
        from deal_payments_plan p join deals d on d.id = p.deal_id left join v_execution_pipeline x on x.deal_id = d.id
        where p.certainty = 'committed' and p.matched_tx_id is null and p.deleted_at is null and d.deleted_at is null
          and p.expected_date between ${asOf} and ${addDays(asOf, 60)}`,
      sql<{ id: string; client_name: string; days: number; email: string | null }[]>`
        select d.id, d.client_name, (${asOf}::date - d.last_activity_at::date)::int as days, u.email from deals d left join users u on u.id = d.owner_user_id
        where d.status = 'open' and d.division = 'finance' and d.deleted_at is null and d.last_activity_at is not null and d.last_activity_at::date <= ${addDays(asOf, -30)}`,
      (async () => { const a = await bankAccount(); return a ? latestAnchor(a.id, asOf) : null })(),
    ])
    const blockers = await closingBlockers(month)

    const events = planCalendarEvents({
      asOf, baseUrl: process.env.APP_BASE_URL ?? '',
      people: { dan: str(s.notify_email_dan), nissim: str(s.notify_email_nissim), hadas: str(s.notify_email_hadas) },
      settings: { payrollPayDay: num(s.payroll_pay_day), payrollApprovalDay: num(s.payroll_approval_day), accountantCloseDay: num(s.accountant_close_day), vatDay: num(s.vat_day), vatBimonthly: s.vat_bimonthly === true },
      closingBlockers: [{ month, items: blockers.map((b) => b.label) }],
      transferDue: card[0] ? { month: card[0].month, amount: card[0].line8_transfer_due } : null,
      expectedAdvance: averageRecentAdvances(advances.map((a) => ({ id: a.id, date: a.date, amountGross: a.amount_gross, method: a.method, period: a.period })), month),
      payrollDrafts: months.map((m) => ({ month: m, names: payroll.filter((p) => p.period === m && p.status === 'draft').map((p) => p.name) })),
      payrollTotals: months.map((m) => { const rows = payroll.filter((p) => p.period === m && p.status !== 'draft'); return { month: m, total: rows.reduce((a, r) => a + (r.employer_cost_est ?? r.gross_total ?? 0), 0), lines: rows.map((r) => `${r.name} ${Math.round(r.employer_cost_est ?? r.gross_total ?? 0).toLocaleString('he-IL')} ₪`) } }).filter((t) => t.lines.length),
      accountantChecklist: months.map((m) => ({ month: m, items: checklist.filter((c) => c.period === m).map((c) => ({ label: c.label, done: c.is_done })) })),
      vatLiability: vat.map((v) => ({ month: v.vat_month, amount: v.liability })),
      cardCharges: cards.map((c) => ({ accountId: c.id, name: c.name, billingDay: c.billing_day, expected: c.expected, details: c.details })),
      receipts: receipts.map((r) => ({ planId: r.id, date: r.date, client: r.client, amount: r.amount, nextMissing: r.next_missing })),
      decayedDeals: decayed.map((d) => ({ dealId: d.id, client: d.client_name, daysStale: d.days, ownerEmail: d.email })),
      anchorStale: !anchor || anchor.date < addDays(asOf, -2) ? { lastDate: anchor?.date ?? null } : null,
    })

    let queued = 0
    for (const e of events) {
      const fingerprint = createHash('sha1').update(eventFingerprint(e)).digest('hex').slice(0, 16)
      const payload: CalendarPayload = { event: e, fingerprint, calendarIds }
      const n = await enqueueOutbox([{ channel: 'calendar', target: calendarIds.join(','), subject: e.title, body: e.description, dedupKey: `cal:${e.ruleKey}:${fingerprint}` }])
      if (n) { await sql`update outbox set payload = ${sql.json(payload as never)} where dedup_key = ${`cal:${e.ruleKey}:${fingerprint}`}`; queued++ }
    }
    const flush = canWrite ? await flushOutbox() : null
    return { rowsTouched: queued, detail: { planned: events.length, queued, calendarIds, calendarConnected: canWrite, flush }, skipped: canWrite ? undefined : `${queued} אירועים ממתינים ב-outbox — יומן לא מחובר (calendar.events)` }
  })
}
