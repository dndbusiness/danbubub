/**
 * סיכום יום — ADDENDUM ב.4. פונקציה אחת לנתונים ואחת ל-HTML; אותו HTML במסך
 * (/reports/daily/[date]), במייל וב-PDF (הנחיה 20: "אין שני מנועי דוחות").
 */
import { sql } from '@/lib/db'
import { bankAccount, latestAnchor, loadCashflow } from '@/lib/queries/cashflow'
import { attentionCounts, listAlerts } from '@/lib/queries/dashboard'
import { addDays } from '@/lib/rules/period'
import { formatMoney } from '@/lib/ui/format'

export interface DailySummaryData {
  date: string
  isSaturday: boolean
  status: { anchorDate: string | null; balance: number | null; stale: boolean; availableCredit: number | null; low30: { date: string; balance: number } | null }
  inYesterday: { client: string; amount: number; dealId: string | null; hasInvoice: boolean }[]
  out48h: { date: string; label: string; amount: number; certainty: string }[]
  inThisWeek: { date: string; label: string; amount: number; dealId: string | null; nextMissing: string | null }[]
  attention: { unknownTx: number; inboxPending: number; expensesNoInvoiceOver500: number; openQuestions: number; overdueTasks: number }
  alerts: { title: string; severity: string; amount: number | null }[]
  itemsCount: number
  minutes: number
}

export async function buildDailySummary(date: string): Promise<DailySummaryData> {
  const yesterday = addDays(date, -1)
  const weekEnd = addDays(date, 7)
  const account = await bankAccount()
  const anchor = account ? await latestAnchor(account.id, date) : null
  const cf = await loadCashflow(date)
  const ok = 'error' in cf ? null : cf
  const [inY, counts, alerts, noInv, pipeline] = await Promise.all([
    sql<{ client: string; amount: number; deal_id: string | null; has_invoice: boolean }[]>`
      select coalesce(d.client_name, t.counterparty, t.description, '—') as client, t.amount_net as amount, t.deal_id,
             t.invoice_status = 'has_invoice' as has_invoice
      from transactions t left join deals d on d.id = t.deal_id
      where t.nature = 'income' and t.certainty = 'actual' and t.deleted_at is null and t.date_cash = ${yesterday}
      order by t.amount_net desc`,
    attentionCounts(),
    listAlerts(),
    sql<{ n: number }[]>`
      select count(*)::int as n from transactions where nature = 'expense' and invoice_status in ('missing', 'unknown') and deleted_at is null
        and certainty = 'actual' and abs(amount_gross) > 500 and date_cash >= ${addDays(date, -90)}`,
    sql<{ deal_id: string; next_missing: string | null }[]>`select deal_id, next_missing from v_execution_pipeline`,
  ])
  const nextMissing = new Map(pipeline.map((p) => [p.deal_id, p.next_missing]))
  const items = ok?.items ?? []
  const low30 = ok ? ok.result.weeks.slice(0, 5).reduce<{ date: string; balance: number } | null>((m, w) => (!m || w.balanceCommitted < m.balance ? { date: w.weekEnd, balance: w.balanceCommitted } : m), null) : null
  const attention = { unknownTx: counts.unknown_tx, inboxPending: counts.inbox_pending, expensesNoInvoiceOver500: noInv[0]?.n ?? 0, openQuestions: counts.open_questions, overdueTasks: counts.overdue_tasks }
  const itemsCount = Object.values(attention).reduce((a, b) => a + b, 0) + alerts.length
  return {
    date,
    isSaturday: new Date(`${date}T00:00:00Z`).getUTCDay() === 6,
    status: { anchorDate: anchor?.date ?? null, balance: anchor?.balance ?? null, stale: !anchor || anchor.date < yesterday, availableCredit: anchor?.available_credit ?? null, low30 },
    inYesterday: inY.map((r) => ({ client: r.client, amount: r.amount, dealId: r.deal_id, hasInvoice: r.has_invoice })),
    out48h: items.filter((i) => i.amount < 0 && i.date >= date && i.date <= addDays(date, 1)).map((i) => ({ date: i.date, label: i.label, amount: i.amount, certainty: i.certainty })),
    inThisWeek: items.filter((i) => i.amount > 0 && i.certainty === 'committed' && i.date >= date && i.date <= weekEnd).map((i) => ({ date: i.date, label: i.label, amount: i.amount, dealId: i.refId ?? null, nextMissing: null })).map((i) => ({ ...i, nextMissing: i.dealId ? nextMissing.get(i.dealId) ?? null : null })),
    attention,
    alerts: alerts.map((a) => ({ title: a.title, severity: a.severity, amount: a.amount })),
    itemsCount,
    minutes: itemsCount * 2,
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const d = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** HTML RTL קצר (מסך אחד בנייד), CSS inline — כי כך Gmail מציג. הקישורים לפי baseUrl. */
export function renderDailySummaryHtml(s: DailySummaryData, baseUrl: string): string {
  const L = (path: string, text: string) => `<a href="${baseUrl}${path}" style="color:#0F766E;text-decoration:none">${esc(text)}</a>`
  const M = (v: number) => `<span dir="ltr" style="font-variant-numeric:tabular-nums;color:${v < 0 ? '#DC2626' : '#111827'}">${formatMoney(v)}</span>`
  const h2 = (t: string) => `<h2 style="font-size:14px;margin:16px 0 6px;color:#6B7280">${t}</h2>`
  const li = (inner: string) => `<li style="padding:4px 0;border-bottom:1px solid #E6E8EC">${inner}</li>`
  const ul = (rows: string[], empty: string) => rows.length ? `<ul style="list-style:none;padding:0;margin:0">${rows.join('')}</ul>` : `<p style="color:#9CA3AF;margin:0">${empty}</p>`
  const quiet = !s.itemsCount

  const status = `${h2('1. מצב')}<p style="margin:0">
    ${s.status.balance === null ? '<b style="color:#DC2626">לא הוזן עוגן!</b>' : `${s.status.stale ? '<b style="color:#DC2626">לא עודכן!</b> ' : ''}יתרה ${M(s.status.balance)} (עוגן ${d(s.status.anchorDate!)})`}
    ${s.status.availableCredit != null ? ` · מסגרת פנויה ${M(s.status.availableCredit)}` : ''}
    ${s.status.low30 ? ` · נקודה נמוכה 30 יום ${M(s.status.low30.balance)} ב-${d(s.status.low30.date)}` : ''} · ${L('/cashflow', 'תזרים')}</p>`
  if (quiet) {
    // ב.4: "אם אין שום דבר ב-5 ו-6: מייל של 3 שורות."
    return wrap(s, `${status}<p style="margin:12px 0 0">נכנס אתמול: ${s.inYesterday.length ? s.inYesterday.map((r) => `${esc(r.client)} ${formatMoney(r.amount)}`).join(', ') : 'כלום'}.</p><p style="margin:8px 0 0;color:#16A34A">אין פריטים שדורשים אותך היום.</p>`)
  }
  const body = [
    status,
    h2('2. נכנס אתמול'), ul(s.inYesterday.map((r) => li(`${r.dealId ? L(`/deals/${r.dealId}`, r.client) : esc(r.client)} ${M(r.amount)} · חשבונית ${r.hasInvoice ? '✓' : '<span style="color:#DC2626">✗</span>'}`)), 'לא נכנסו תקבולים אתמול'),
    h2('3. יוצא היום / מחר'), ul(s.out48h.map((r) => li(`${d(r.date)} · ${esc(r.label)} ${M(r.amount)}`)), 'אין חיובים ב-48 השעות הקרובות'),
    h2('4. צפוי להיכנס השבוע (ודאי)'), ul(s.inThisWeek.map((r) => li(`${d(r.date)} · ${r.dealId ? L(`/deals/${r.dealId}`, r.label) : esc(r.label)} ${M(r.amount)}${r.nextMissing ? ` · <span style="color:#F59E0B">חסר: ${esc(r.nextMissing)}</span>` : ''}`)), 'אין תקבולים ודאיים השבוע'),
    h2('5. דורש טיפול'), ul([
      [s.attention.unknownTx, L('/transactions', 'תנועות לא מזוהות')], [s.attention.inboxPending, L('/import', 'חשבוניות במייל לאישור')],
      [s.attention.expensesNoInvoiceOver500, L('/transactions', 'הוצאות בלי חשבונית מעל 500 ₪')], [s.attention.openQuestions, L('/questions', 'שאלות פתוחות לשותפים')],
      [s.attention.overdueTasks, L('/tasks', 'משימות שפג תוקפן')],
    ].filter(([n]) => Number(n) > 0).map(([n, l]) => li(`<b>${n}</b> ${l}`)), 'הכול מטופל'),
    h2('6. התראות פעילות'), ul(s.alerts.map((a) => li(`<span style="color:${a.severity === 'critical' ? '#DC2626' : a.severity === 'high' ? '#F59E0B' : '#6B7280'}">●</span> ${esc(a.title)}${a.amount != null ? ` ${M(a.amount)}` : ''}`)), 'אין התראות'),
    `<p style="margin:16px 0 0;font-weight:600">${s.itemsCount} פריטים דורשים אותך היום, זמן משוער ${s.minutes} דקות. ${L('/', 'למצב החברה')}</p>`,
  ].join('')
  return wrap(s, body)
}

function wrap(s: DailySummaryData, body: string): string {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>סיכום יומי ${s.date}</title></head>
<body style="margin:0;background:#F7F8FA;font-family:Heebo,Assistant,Arial,sans-serif;color:#111827;font-size:14px">
<div style="max-width:560px;margin:0 auto;background:#fff;padding:20px;border-radius:12px">
<h1 style="font-size:18px;margin:0">הר-אל · סיכום יומי ${d(s.date)}/${s.date.slice(0, 4)}</h1>
<div style="color:#6B7280;font-size:12px;margin-bottom:8px">הופק אוטומטית (ADDENDUM ב.4) · לדן בלבד</div>
${body}
</div></body></html>`
}
