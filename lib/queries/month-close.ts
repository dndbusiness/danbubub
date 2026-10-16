import { sql, withActor } from '@/lib/db'
import { computeMonthCloseChecklist, monthCloseStatus, type MonthCloseFacts, type MonthCloseStatus } from '@/lib/rules/month-close'
import { monthRange } from '@/lib/rules/period'

/** ב.7 — אוסף את העובדות ומחשב את הצ'קליסט. כל ✓ מהנתונים, אף אחד לא מסמן ידנית. */
export async function monthCloseFacts(month: string): Promise<MonthCloseFacts> {
  const { from, to } = monthRange(month)
  const [r] = await sql<{
    imported_batches: number; unknown_transactions: number; stale_open_expenses: number
    missing_invoices: number; missing_invoice_vat: number; payroll_sent_at: string | null
    nissim_card_closed: boolean; pnl_final_at: string | null; gaps_report_at: string | null
  }[]>`
    select
      (select count(*)::int from import_batches b where b.status = 'applied' and b.deleted_at is null
         and b.source in ('card_import', 'bank_import')
         and exists (select 1 from transactions t where t.source = b.source and t.deleted_at is null and t.date_cash between ${from} and ${to})) as imported_batches,
      (select count(*)::int from transactions where review_status <> 'ok' and deleted_at is null and date_cash between ${from} and ${to}) as unknown_transactions,
      (select count(*)::int from invoices where direction = 'received' and deleted_at is null and matched_tx_id is null
         and reported = false and date < current_date - 30) as stale_open_expenses,
      (select count(*)::int from transactions where nature in ('income','expense') and certainty = 'actual' and deleted_at is null
         and invoice_status in ('missing','unknown') and date_cash between ${from} and ${to}) as missing_invoices,
      (select coalesce(sum(input_vat_missing_invoice), 0) from v_vat where vat_month = ${month}) as missing_invoice_vat,
      (select max(sent_at)::text from report_runs where report_type = 'payroll' and period = ${month} and deleted_at is null) as payroll_sent_at,
      (select count(*) > 0 from periods where division = 'finance' and status = 'closed' and deleted_at is null
         and year = ${Number(month.slice(0, 4))} and month = ${Number(month.slice(5, 7))}) as nissim_card_closed,
      (select max(created_at)::text from report_runs where report_type = 'pnl_final' and period = ${month} and deleted_at is null) as pnl_final_at,
      (select max(created_at)::text from report_runs where report_type = 'invoice_gaps' and period = ${month} and deleted_at is null) as gaps_report_at`
  return {
    month,
    importedBatches: r?.imported_batches ?? 0,
    unknownTransactions: r?.unknown_transactions ?? 0,
    staleOpenExpenses: r?.stale_open_expenses ?? 0,
    missingInvoices: r?.missing_invoices ?? 0,
    missingInvoiceVat: Number(r?.missing_invoice_vat ?? 0),
    payrollSentAt: r?.payroll_sent_at ?? null,
    nissimCardClosed: Boolean(r?.nissim_card_closed),
    pnlFinalAt: r?.pnl_final_at ?? null,
    gapsReportAt: r?.gaps_report_at ?? null,
  }
}

/** מחשב, שומר ל-month_close_checklist (כדי שאירוע היומן והדוחות יקראו אותו), ומחזיר. */
export async function refreshMonthClose(month: string): Promise<MonthCloseStatus> {
  const items = computeMonthCloseChecklist(await monthCloseFacts(month))
  await withActor(async (tx) => {
    for (const i of items) {
      await tx`
        insert into month_close_checklist (period, item_key, label, is_done, checked_at, detail)
        values (${month}, ${i.key}, ${i.label}, ${i.done}, now(), ${i.detail})
        on conflict (period, item_key) do update set label = excluded.label, is_done = excluded.is_done, checked_at = now(), detail = excluded.detail`
    }
  })
  return monthCloseStatus(items)
}

export async function monthCloseStatusFor(month: string): Promise<MonthCloseStatus> {
  return monthCloseStatus(computeMonthCloseChecklist(await monthCloseFacts(month)))
}
