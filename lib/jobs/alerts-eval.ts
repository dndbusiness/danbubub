import { sql, withActor } from '@/lib/db'
import { evaluateAlerts, reconcileAlerts, type Alert } from '@/lib/rules/alerts'
import { outboxRowsForAlert } from '@/lib/rules/notifications'
import { addDays, monthOf } from '@/lib/rules/period'
import { alertThresholds, bankAccount, dailyCloses, latestAnchor, loadCashflow, settingValues } from '@/lib/queries/cashflow'
import { fixedExpenseMonths, listFixedExpenses } from '@/lib/queries/fixed-expenses'
import { enqueueOutbox, flushOutbox } from './outbox'
import { runJob } from './run'

export interface AlertsEvalOutcome { rowsTouched: number; skipped?: string; detail?: Record<string, unknown>; created: number; resolved: number; active: number; queued: number }

/**
 * חלק ג' `alerts_eval` (06:45 יומי + אחרי כל ייבוא) — ADDENDUM ב.11.
 * אוסף את הקלט מה-DB, מריץ את הכללים הטהורים (lib/rules/alerts.ts), ממזג עם
 * ההתראות הפעילות לפי rule_key (הנחיה 18), וכותב הודעות ל-outbox (הנחיה 16).
 */
export async function alertsEvalJob(asOf: string): Promise<AlertsEvalOutcome> {
  return runJob('alerts_eval', async () => {
    const month = monthOf(asOf)
    const thresholds = await alertThresholds()
    const account = await bankAccount()
    const anchor = account ? await latestAnchor(account.id, asOf) : null
    const cf = anchor ? await loadCashflow(asOf) : null
    const ok = cf && !('error' in cf) ? cf : null

    // 30 יום קדימה — ודאי בלבד (כלל 2)
    const to30 = addDays(asOf, 30)
    const in30 = ok ? ok.items.filter((i) => i.certainty === 'committed' && i.date > asOf && i.date <= to30) : []
    const committedOutflow30d = -in30.filter((i) => i.amount < 0).reduce((a, i) => a + i.amount, 0)
    const committedInflow30d = in30.filter((i) => i.amount > 0).reduce((a, i) => a + i.amount, 0)

    const [closes, fixed, vatRows, incomeNoInv, unpaid, nissim, advMonth, decayed, failed, budgets, settings, disconnected, existing] = await Promise.all([
      dailyCloses(1),
      listFixedExpenses(),
      sql<{ missing: number; n: number }[]>`
        select coalesce(sum(input_vat_missing_invoice), 0) as missing, coalesce(sum(missing_invoice_count), 0)::int as n
        from v_vat where vat_month >= ${monthOf(addDays(asOf, -90))}`,
      sql<{ id: string; date: string; amount: number }[]>`
        select id, to_char(date_cash, 'YYYY-MM-DD') as date, amount_net as amount from transactions
        where nature = 'income' and invoice_status in ('missing', 'unknown') and deleted_at is null and certainty = 'actual'
          and date_cash <= ${addDays(asOf, -thresholds.incomeWithoutInvoiceDays)} and date_cash >= ${addDays(asOf, -120)}`,
      sql<{ id: string; date: string; amount: number }[]>`
        select id, to_char(date, 'YYYY-MM-DD') as date, amount_gross as amount from invoices
        where direction = 'issued' and matched_tx_id is null and deleted_at is null and date <= ${addDays(asOf, -30)}`,
      sql<{ month: string; line5_nissim_share: number; line7_closing_balance: number }[]>`
        select month, line5_nissim_share, line7_closing_balance from v_nissim_card where month <= ${month} order by month desc limit 1`,
      sql<{ amount: number }[]>`select coalesce(sum(amount_gross), 0) as amount from advances where period = ${month} and deleted_at is null`,
      sql<{ id: string; client_name: string; days: number; owner_user_id: string | null }[]>`
        select id, client_name, (${asOf}::date - last_activity_at::date)::int as days, owner_user_id from deals
        where status = 'open' and division = 'finance' and deleted_at is null and last_activity_at is not null
          and last_activity_at::date <= ${addDays(asOf, -30)}`,
      sql<{ job_name: string; started_at: string; error: string | null }[]>`
        select job_name, to_char(started_at, 'YYYY-MM-DD') as started_at, error from scheduled_jobs_log
        where status = 'failed' and started_at > now() - interval '24 hours' and job_name <> 'alerts_eval'`,
      sql<{ category_id: string; category_name: string; budget: number; spent: number }[]>`
        select b.category_id, c.name as category_name, b.amount_net as budget,
               coalesce((select abs(sum(t.amount_net)) from v_tx_classified t
                         where t.category_id = b.category_id and t.nature = 'expense' and to_char(t.date_cash, 'YYYY-MM') = b.period), 0) as spent
        from budgets b join categories c on c.id = b.category_id where b.period = ${month} and b.deleted_at is null`,
      settingValues(['notify_whatsapp_dan', 'notify_email_dan']),
      sql<{ provider: string; account_label: string; status: string }[]>`
        select provider, account_label, status from integrations where deleted_at is null and status <> 'connected'`,
      sql<{ id: string; rule_key: string; snoozed_until: string | null }[]>`
        select id, rule_key, to_char(snoozed_until, 'YYYY-MM-DD') as snoozed_until from alerts where resolved_at is null and deleted_at is null`,
    ])

    const fxMonths = await fixedExpenseMonths(fixed, month, asOf, 2)
    const fixedExpenseStatus = fixed.flatMap((f) =>
      (fxMonths.get(f.id) ?? [])
        .filter((m) => m.status === 'missing' || m.status === 'deviation')
        .map((m) => ({ fixedExpenseId: f.id, name: f.name, expectedDate: m.expectedDate, expectedAmount: -m.expected, actualAmount: m.actual === null ? undefined : -m.actual })),
    )
    const todayClose = closes[0]?.date === asOf ? closes[0] : undefined

    const current = evaluateAlerts({
      asOf, thresholds,
      firstNegativeWeek: ok?.result.firstNegativeWeek ?? null,
      lowPointBalance: ok?.result.lowPoint?.balance,
      committedOutflow30d: ok ? committedOutflow30d : undefined,
      committedInflow30d: ok ? committedInflow30d : undefined,
      currentBalance: anchor?.balance,
      dailyVariance: todayClose?.variance,
      lastAnchorDate: anchor?.date,
      fixedExpenseStatus,
      missingInputVat: vatRows[0]?.missing ?? 0,
      missingInvoiceCount: vatRows[0]?.n ?? 0,
      incomeWithoutInvoice: incomeNoInv.map((r) => ({ txId: r.id, date: r.date, amount: r.amount })),
      invoicesUnpaid: unpaid.map((r) => ({ invoiceId: r.id, date: r.date, amount: r.amount })),
      nissimBalance: nissim[0]?.line7_closing_balance,
      advancesThisMonth: advMonth[0]?.amount ?? 0,
      expectedNissimShareMtd: nissim[0]?.month === month ? nissim[0].line5_nissim_share : undefined,
      decayedDeals: decayed.map((d) => ({ dealId: d.id, clientName: d.client_name, daysStale: d.days, ownerUserId: d.owner_user_id ?? undefined })),
      failedJobs: failed.map((j) => ({ jobName: j.job_name, failedAt: j.started_at, error: j.error ?? undefined })),
      budgetOverruns: budgets.map((b) => ({ categoryId: b.category_id, categoryName: b.category_name, spent: b.spent, budget: b.budget })),
      disconnectedIntegrations: disconnected.map((i) => (i.provider === 'google' ? `Google (${i.account_label})` : i.provider)),
    })

    const rec = reconcileAlerts(current, existing.map((e) => ({ ruleKey: e.rule_key, snoozedUntil: e.snoozed_until ?? undefined })))
    const targets = { whatsapp: typeof settings.notify_whatsapp_dan === 'string' ? settings.notify_whatsapp_dan : null, email: typeof settings.notify_email_dan === 'string' ? settings.notify_email_dan : null }
    let queued = 0
    const toNotify: { alert: Alert; id: string }[] = []
    await withActor(async (tx) => {
      for (const a of rec.toCreate) {
        const [row] = await tx<{ id: string }[]>`
          insert into alerts (kind, rule_key, severity, channels, title, detail, amount, ref_ids)
          values (${a.kind}, ${a.ruleKey}, ${a.severity}, ${a.channels}, ${a.title}, ${a.detail ?? null}, ${a.amount ?? null}, ${a.refIds ?? null})
          on conflict (rule_key) where resolved_at is null and deleted_at is null do nothing
          returning id`
        if (row) toNotify.push({ alert: a, id: row.id })
      }
      // ב.1: "אם ההרשאה נופלת — התראה + משימה 'לחבר מחדש את גוגל'" (rule_key ייחודי, הנחיה 18).
      for (const i of disconnected) {
        await tx`
          insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
          values (${`לחבר מחדש את ${i.provider === 'google' ? 'גוגל' : i.provider} (${i.account_label})`}, ${asOf}, 'urgent', true, ${`integration_disconnected:${i.provider}:${i.account_label}`}, 'ADDENDUM ב.1 — ההרשאה נפלה; /settings')
          on conflict do nothing`
      }
      if (rec.toResolve.length) {
        await tx`update alerts set resolved_at = now(), resolved_note = 'התנאי חדל להתקיים' where rule_key = any(${rec.toResolve}) and resolved_at is null and deleted_at is null`
      }
    })
    // ה-outbox נכתב אחרי ה-commit של ההתראות (FK alert_id).
    for (const n of toNotify) queued += await enqueueOutbox(outboxRowsForAlert(n.alert, targets, process.env.APP_BASE_URL ?? ''), { alertId: n.id })
    const flush = queued ? await flushOutbox() : null
    return {
      rowsTouched: rec.toCreate.length + rec.toResolve.length,
      created: rec.toCreate.length, resolved: rec.toResolve.length, active: current.length, queued,
      detail: { kinds: current.map((c: Alert) => c.kind), flush, targetsConfigured: { whatsapp: Boolean(targets.whatsapp), email: Boolean(targets.email) } },
    }
  })
}
