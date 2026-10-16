'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Ban, Download, FileWarning, Send, UserCheck } from 'lucide-react'
import { markNoInvoiceNeeded, resolvePartnerInvoice, sendGapsReport } from '@/app/actions/gaps'
import { DataTable, type Column } from '@/components/data-table'
import { DrillDrawer } from '@/components/drill-drawer'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/status-pill'
import type { GapMonthRow, GapRow, ReportRunRow } from '@/lib/queries/gaps'
import { GAP_LABEL } from '@/lib/ui/labels'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

type PartnerInvoice = { id: string; date: string; counterparty: string | null; amount_gross: number; doc_number: string | null; partner_name: string | null }
type GiSummary = { total: number; reported: number; open: number; unmatched: number; last_import: string | null }

const heMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`
/** רק פער שמקורו בתנועה אפשר לסמן "לא נדרשת חשבונית" — חשבונית שהוצאה היא לא תנועה. */
const isTransactionGap = (kind: string) => kind !== 'invoice_without_receipt'

export function GapsView({ months, lines, partners, greenInvoice, lastRun }: {
  months: GapMonthRow[]
  lines: GapRow[]
  partners: PartnerInvoice[]
  greenInvoice: GiSummary
  lastRun: ReportRunRow | null
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [tab, setTab] = React.useState<'months' | 'lines' | 'partners'>('months')
  const [filter, setFilter] = React.useState<{ kind: string | null; month: string | null }>({ kind: null, month: null })
  const [drill, setDrill] = React.useState<{ kind: string; month: string } | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const notify = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 10_000) }

  const totals = React.useMemo(() => ({
    income: months.reduce((a, m) => a + m.income_without_invoice, 0),
    incomeAmount: months.reduce((a, m) => a + Number(m.income_without_invoice_amount), 0),
    unpaid: months.reduce((a, m) => a + m.invoice_without_receipt, 0),
    unpaidAmount: months.reduce((a, m) => a + Number(m.invoice_without_receipt_amount), 0),
    expense: months.reduce((a, m) => a + m.expense_without_invoice, 0),
    expenseAmount: months.reduce((a, m) => a + Number(m.expense_without_invoice_amount), 0),
    vat: months.reduce((a, m) => a + Number(m.vat_at_risk), 0),
  }), [months])

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => { const r = await fn(); if (!r.ok) { setError(r.error); return } setError(null); notify(done); router.refresh() })

  const showLines = (kind: string, month?: string) => { setFilter({ kind, month: month ?? null }); setTab('lines') }

  const num = (count: number, amount: number, kind: string, month: string) =>
    count === 0 ? <span className="text-text-3">—</span> : (
      <button type="button" className="underline inline-flex items-center gap-1" onClick={() => setDrill({ kind, month })}>
        <Money value={amount} nature={kind === 'expense_without_invoice' ? 'open' : undefined} />
        <StatusPill tone={kind === 'income_without_invoice' ? 'expected' : 'open'}>{count}</StatusPill>
      </button>
    )

  const monthColumns: Column<GapMonthRow & { id: string }>[] = [
    { key: 'month', header: 'חודש', cell: (m) => <span className="font-medium">{heMonth(m.month)}</span> },
    { key: 'income_without_invoice', header: 'הכנסה בלי חשבונית', align: 'end', value: (m) => Number(m.income_without_invoice_amount), cell: (m) => num(m.income_without_invoice, Number(m.income_without_invoice_amount), 'income_without_invoice', m.month), footer: <Money value={totals.incomeAmount} /> },
    { key: 'invoice_without_receipt', header: 'חשבונית בלי תקבול', align: 'end', value: (m) => Number(m.invoice_without_receipt_amount), cell: (m) => num(m.invoice_without_receipt, Number(m.invoice_without_receipt_amount), 'invoice_without_receipt', m.month), footer: <Money value={totals.unpaidAmount} /> },
    { key: 'expense_without_invoice', header: 'הוצאה בלי חשבונית ספק', align: 'end', value: (m) => Number(m.expense_without_invoice_amount), cell: (m) => num(m.expense_without_invoice, Number(m.expense_without_invoice_amount), 'expense_without_invoice', m.month), footer: <Money value={totals.expenseAmount} /> },
    { key: 'vat_at_risk', header: 'מע״מ בסיכון', align: 'end', value: (m) => Number(m.vat_at_risk), cell: (m) => Number(m.vat_at_risk) ? <Money value={Number(m.vat_at_risk)} nature="open" /> : <span className="text-text-3">—</span>, footer: <Money value={totals.vat} nature="open" /> },
  ]

  const filtered = lines.filter((l) => (!filter.kind || l.gap_kind === filter.kind) && (!filter.month || l.date.slice(0, 7) === filter.month))

  const lineColumns: Column<GapRow & { id: string }>[] = [
    { key: 'date', header: 'תאריך', cell: (l) => formatDate(l.date), value: (l) => l.date },
    { key: 'gap_kind', header: 'סוג הפער', cell: (l) => <span className="text-xs">{GAP_LABEL[l.gap_kind] ?? l.gap_kind}</span> },
    { key: 'counterparty', header: 'מי', cell: (l) => <span className="truncate">{l.counterparty ?? l.description ?? '—'}</span> },
    { key: 'description', header: 'פרטים', mobileHidden: true, cell: (l) => <span className="text-xs text-text-3 truncate">{l.description ?? '—'}</span> },
    { key: 'amount', header: 'סכום', align: 'end', value: (l) => Number(l.amount), cell: (l) => <Money value={Number(l.amount)} />, footer: <Money value={filtered.reduce((a, l) => a + Number(l.amount), 0)} /> },
    { key: 'vat_at_risk', header: 'מע״מ בסיכון', align: 'end', value: (l) => Number(l.vat_at_risk), cell: (l) => Number(l.vat_at_risk) ? <Money value={Number(l.vat_at_risk)} nature="open" /> : <span className="text-text-3">—</span>, footer: <Money value={filtered.reduce((a, l) => a + Number(l.vat_at_risk), 0)} nature="open" /> },
    {
      key: 'actions', header: '', cell: (l) => isTransactionGap(l.gap_kind) ? (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" disabled={pending} title="לא נדרשת חשבונית (עמלת בנק, מס, ביטוח לאומי)"
            onClick={() => act(() => markNoInvoiceNeeded(l.ref_id), 'סומן שלא נדרשת חשבונית')}><Ban size={14} /></Button>
        </span>
      ) : null,
    },
  ]

  const drillLines = drill ? lines.filter((l) => l.gap_kind === drill.kind && l.date.slice(0, 7) === drill.month) : []

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="מע״מ בסיכון" value={totals.vat} nature="open"
          subtitle="זה מה שמפסידים אם החשבוניות לא יושגו"
          drillTitle="מע״מ בסיכון לפי חודש"
          drill={<ul className="divide-y divide-border text-sm">{months.filter((m) => Number(m.vat_at_risk) > 0).map((m) => <li key={m.month} className="flex justify-between py-2"><span>{heMonth(m.month)} · {m.expense_without_invoice} הוצאות</span><Money value={Number(m.vat_at_risk)} nature="open" /></li>)}{!months.some((m) => Number(m.vat_at_risk) > 0) && <li className="py-2 text-text-3">אין</li>}</ul>} />
        <KpiCard title="הכנסה בבנק בלי חשבונית" value={totals.incomeAmount} nature={totals.income ? 'open' : undefined}
          subtitle={`${totals.income} תקבולים · בדיקה 1א`}
          drillTitle="הכנסות בלי חשבונית" drill={<KindList lines={lines} kind="income_without_invoice" />} />
        <KpiCard title="חשבונית בלי תקבול" value={totals.unpaidAmount} certainty="committed"
          subtitle={`${totals.unpaid} חשבוניות · זה מה שחייבים לנו`}
          drillTitle="חשבוניות שלא נגבו" drill={<KindList lines={lines} kind="invoice_without_receipt" />} />
        <KpiCard title="הוצאה בלי חשבונית ספק" value={totals.expenseAmount} nature={totals.expense ? 'open' : undefined}
          subtitle={`${totals.expense} הוצאות · בדיקה 2`}
          drillTitle="הוצאות בלי חשבונית" drill={<KindList lines={lines} kind="expense_without_invoice" />} />
      </div>

      <Card className="flex flex-wrap items-center gap-3 text-sm">
        <FileWarning size={16} className="text-text-2" />
        <span className="font-medium">שליחת הדוח לרו״ח</span>
        <span className="text-text-2 text-xs">12 חודשים אחורה, כולל הפירוט לכל בדיקה. נשמר ב-outbox ומסומן בצ׳קליסט סגירת החודש.</span>
        <span className="ms-auto flex flex-wrap gap-2">
          <a href="/api/reports/gaps" target="_blank" rel="noreferrer"><Button variant="secondary" type="button"><Download size={16} /> תצוגה מקדימה</Button></a>
          <Button variant="primary" disabled={pending}
            onClick={() => start(async () => {
              const r = await sendGapsReport()
              if (!r.ok) { setError(r.error); return }
              setError(null)
              notify(
                r.sent ? `הדוח נשלח ל-${r.recipients.join(', ')}`
                : r.queued ? 'הדוח ממתין ב-outbox — יישלח בניסיון הבא'
                : r.recipients.length ? 'הדוח הופק — הודעה זהה כבר ממתינה במשלוח היום (הנחיה 16)'
                : 'הדוח הופק, אבל אין כתובת רו״ח בהגדרות')
              router.refresh()
            })}><Send size={16} /> שלח לרו״ח</Button>
        </span>
        <span className="w-full text-xs text-text-3">
          {lastRun
            ? `נשלח לאחרונה: ${formatDate(lastRun.created_at.slice(0, 10))}${lastRun.recipients.length ? ` · ${lastRun.recipients.join(', ')}` : ' · לא נשלח לאף אחד'}`
            : 'טרם נשלח דוח פערים'}
          {' · '}חשבונית ירוקה: {greenInvoice.total} מסמכים, {greenInvoice.unmatched} בלי התאמה לתנועה
          {greenInvoice.last_import ? ` · ייבוא אחרון ${formatDate(greenInvoice.last_import.slice(0, 10))}` : ' · טרם יובא'}
        </span>
      </Card>

      <div className="flex gap-1 border-b border-border">
        {([['months', `לפי חודש (${months.length})`], ['lines', `שורות (${lines.length})`], ['partners', `חשבוניות שותפים לאישור (${partners.length})`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setTab(k); if (k === 'lines' && filter.kind === null) setFilter({ kind: null, month: null }) }}
            className={cn('px-3 py-2 text-sm -mb-px border-b-2', tab === k ? 'border-brand text-text font-medium' : 'border-transparent text-text-2')}>{l}</button>
        ))}
      </div>
      {msg && <p className="text-sm text-actual" role="status">{msg}</p>}
      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      {tab === 'months' && (
        <DataTable rows={months.map((m) => ({ ...m, id: m.month }))} columns={monthColumns} exportName="invoice-gaps"
          primaryKeys={['month', 'expense_without_invoice', 'vat_at_risk']} emptyState="אין פערים ב-12 החודשים האחרונים" />
      )}

      {tab === 'lines' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" onClick={() => setFilter({ kind: null, month: null })}
              className={cn('px-2 py-1 rounded border border-border text-xs', !filter.kind && 'bg-locked-bg font-medium')}>הכול</button>
            {Object.entries(GAP_LABEL).map(([k, label]) => (
              <button key={k} type="button" onClick={() => showLines(k)}
                className={cn('px-2 py-1 rounded border border-border text-xs', filter.kind === k && 'bg-locked-bg font-medium')}>{label}</button>
            ))}
            {filter.month && <span className="text-xs text-text-3">חודש {heMonth(filter.month)} · <button type="button" className="underline" onClick={() => setFilter((f) => ({ ...f, month: null }))}>הסר</button></span>}
          </div>
          <DataTable rows={filtered.map((l) => ({ ...l, id: `${l.gap_kind}:${l.ref_id}` }))} columns={lineColumns} exportName="invoice-gap-lines"
            primaryKeys={['date', 'counterparty', 'amount']} emptyState="אין שורות בפילטר הזה" initialSort={{ key: 'date', dir: 'desc' }} />
        </div>
      )}

      {tab === 'partners' && (
        <div className="flex flex-col gap-2">
          <Card className="text-sm text-text-2">
            חשבונית מספק שהוא ישות של שותף — צריך להכריע אם זו <span className="font-medium">משיכה</span> (חלוקת רווח) או{' '}
            <span className="font-medium">הוצאה</span> של החברה. עד ההכרעה היא נספרת כהוצאה.
          </Card>
          {!partners.length && <Card className="text-sm text-text-3">אין חשבוניות שממתינות להכרעה.</Card>}
          {partners.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center gap-3 text-sm border-s-4 border-s-expected">
              <span className="font-medium">{p.counterparty ?? '—'}</span>
              {p.partner_name && <StatusPill tone="expected">{p.partner_name}</StatusPill>}
              <span className="text-text-2">{formatDate(p.date)}{p.doc_number ? ` · מסמך ${p.doc_number}` : ''}</span>
              <Money value={Number(p.amount_gross)} />
              <span className="ms-auto flex gap-2">
                <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => act(() => resolvePartnerInvoice(p.id, 'draw'), 'סווג כמשיכה')}><UserCheck size={14} /> משיכה</Button>
                <Button size="sm" variant="ghost" disabled={pending}
                  onClick={() => act(() => resolvePartnerInvoice(p.id, 'expense'), 'נשאר כהוצאה')}>הוצאה</Button>
              </span>
            </Card>
          ))}
        </div>
      )}

      <DrillDrawer open={Boolean(drill)} onOpenChange={(o) => !o && setDrill(null)}
        title={drill ? `${GAP_LABEL[drill.kind] ?? drill.kind} · ${heMonth(drill.month)}` : ''}>
        {!drillLines.length ? <p className="text-sm text-text-3">אין שורות</p> : (
          <div className="flex flex-col gap-3">
            <ul className="divide-y divide-border text-sm">
              {drillLines.map((l) => (
                <li key={`${l.gap_kind}:${l.ref_id}`} className="flex justify-between gap-2 py-2">
                  <span className="truncate">{formatDate(l.date)} · {l.counterparty ?? l.description ?? '—'}</span>
                  <span className="flex gap-3 shrink-0">
                    {Number(l.vat_at_risk) ? <span className="text-xs self-center"><Money value={Number(l.vat_at_risk)} nature="open" size="sm" /></span> : null}
                    <Money value={Number(l.amount)} />
                  </span>
                </li>
              ))}
              <li className="flex justify-between pt-2 font-medium"><span>סה״כ</span><Money value={drillLines.reduce((a, l) => a + Number(l.amount), 0)} /></li>
            </ul>
            <Button variant="secondary" onClick={() => { if (drill) showLines(drill.kind, drill.month); setDrill(null) }}>לשורות עם הפעולות</Button>
          </div>
        )}
      </DrillDrawer>
    </div>
  )
}

function KindList({ lines, kind }: { lines: GapRow[]; kind: string }) {
  const rows = lines.filter((l) => l.gap_kind === kind).slice(0, 40)
  if (!rows.length) return <p className="text-sm text-text-3">אין</p>
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((l) => (
        <li key={`${l.gap_kind}:${l.ref_id}`} className="flex justify-between gap-2 py-2">
          <span className="truncate">{formatDate(l.date)} · {l.counterparty ?? l.description ?? '—'}</span>
          <span className="shrink-0 tnum">{formatMoney(Number(l.amount))}</span>
        </li>
      ))}
    </ul>
  )
}
