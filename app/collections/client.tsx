'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, FileText, Gavel, MessageCircle, Receipt, Send, Wallet } from 'lucide-react'
import { markPaid, moveToLegal, previewReminder, requestInvoice, sendReminder } from '@/app/actions/collections'
import { DataTable, type Column } from '@/components/data-table'
import { DrillDrawer } from '@/components/drill-drawer'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { CollectionPill, DivisionPill, StatusPill } from '@/components/status-pill'
import type { AgingCell, CollectionFlagRow, CollectionOpsRow } from '@/lib/queries/collections'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

const DOC_LABEL: Record<string, { label: string; tone: 'open' | 'committed' | 'actual' | 'locked' }> = {
  not_issued: { label: 'לא הוצא', tone: 'open' },
  invoice_issued: { label: 'חשבונית מס הוצאה', tone: 'committed' },
  paid: { label: 'שולם', tone: 'actual' },
  receipt_issued: { label: 'קבלה הוצאה', tone: 'actual' },
}
const FLAG_LABEL: Record<string, string> = {
  receipt_without_invoice: 'תקבול ללא חשבונית מס (7 ימים)',
  invoice_unpaid_30d: 'חשבונית שהוצאה ולא שולמה (30 יום)',
  completed_deal_open_balance: 'תיק הושלם עם יתרה פתוחה',
}
/** UIUX §5.7 — "הצבע מתחמם". */
const BUCKET_TONE: Record<string, 'committed' | 'expected' | 'open'> = { '0-30': 'committed', '31-60': 'expected', '61-90': 'open', '90+': 'open' }

export function CollectionsView({ rows, aging, flags, pipeline, blockers }: {
  rows: CollectionOpsRow[]
  aging: AgingCell[]
  flags: CollectionFlagRow[]
  pipeline: { deal_id: string; client_name: string; owner_name: string | null; amount_at_stake: number; next_missing: string | null; next_status: string | null; blocked_reason: string | null; stuck_days: number | null; completion_pct: number | null }[]
  blockers: { blocker: string; deal_count: number; amount: number; pct_of_total: number }[]
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [tab, setTab] = React.useState<'aging' | 'execution' | 'flags'>('aging')
  const [reminder, setReminder] = React.useState<{ row: CollectionOpsRow; whatsapp: string; emailHtml: string; subject: string; tone: string; phone: string | null; hasWhatsApp: boolean } | null>(null)
  const [paying, setPaying] = React.useState<CollectionOpsRow | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const notify = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 8_000) }

  function openPreview(r: CollectionOpsRow) {
    setError(null)
    start(async () => {
      const p = await previewReminder(r.deal_id)
      if (!p.ok) { setError(p.error); return }
      setReminder({ row: r, whatsapp: p.whatsapp, emailHtml: p.emailHtml, subject: p.subject, tone: p.tone, phone: p.phone, hasWhatsApp: p.hasWhatsApp })
    })
  }
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => { const r = await fn(); if (!r.ok) { setError(r.error); return } setError(null); notify(done); router.refresh() })

  const columns: Column<CollectionOpsRow & { id: string }>[] = [
    { key: 'client_name', header: 'לקוח', cell: (r) => <Link href={`/deals/${r.deal_id}`} className="font-medium underline" onClick={(e) => e.stopPropagation()}>{r.client_name}</Link> },
    { key: 'division', header: 'פעילות', cell: (r) => <DivisionPill division={r.division} />, mobileHidden: true },
    { key: 'open_amount', header: 'פתוח', align: 'end', cell: (r) => <Money value={r.open_amount} certainty={r.open_committed >= r.open_expected ? 'committed' : 'expected'} />, footer: <Money value={rows.reduce((a, r) => a + r.open_amount, 0)} /> },
    { key: 'split', header: 'ודאי / פוטנציאלי', align: 'end', mobileHidden: true, value: (r) => r.open_committed, cell: (r) => <span className="text-xs whitespace-nowrap"><span className="text-committed">{formatMoney(r.open_committed)}</span> · <span className="text-expected">{formatMoney(r.open_expected)}</span></span> },
    { key: 'due_date', header: 'תאריך יעד', value: (r) => r.due_date ?? '', cell: (r) => r.due_date ? formatDate(r.due_date) : <span className="text-text-3">—</span> },
    { key: 'days_overdue', header: 'איחור', align: 'end', value: (r) => r.days_overdue, cell: (r) => r.days_overdue > 0 ? <StatusPill tone={BUCKET_TONE[r.aging_bucket]!}>{r.days_overdue} ימים</StatusPill> : <span className="text-text-3">—</span> },
    { key: 'document_status', header: 'מסמך', value: (r) => r.document_status, cell: (r) => { const d = DOC_LABEL[r.document_status] ?? DOC_LABEL.not_issued!; return <StatusPill tone={d.tone}>{d.label}</StatusPill> } },
    { key: 'collection_status', header: 'גביה', value: (r) => r.collection_status, cell: (r) => <CollectionPill status={r.collection_status} daysOverdue={r.days_overdue} />, mobileHidden: true },
    { key: 'next_missing', header: 'מה חסר', mobileHidden: true, cell: (r) => r.next_missing ? <span className="text-xs text-expected truncate max-w-[140px] inline-block align-bottom">{r.next_missing}{r.stuck_days ? ` · ${r.stuck_days} ימים` : ''}</span> : <span className="text-text-3">—</span> },
    { key: 'last_action_at', header: 'פעולה אחרונה', mobileHidden: true, value: (r) => r.last_action_at ?? '', cell: (r) => r.last_action_at ? <span className="text-xs text-text-3">{r.last_action_kind === 'reminder_sent' ? 'תזכורת' : r.last_action_kind === 'marked_paid' ? 'סומן שולם' : r.last_action_kind === 'moved_to_legal' ? 'משפטי' : 'חשבונית'} · {formatDate(r.last_action_at.slice(0, 10))}</span> : <span className="text-text-3">—</span> },
    {
      key: 'actions', header: '', cell: (r) => (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => openPreview(r)} title="שלח תזכורת"><Send size={14} /></Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setPaying(r)} title="סמן שולם"><Wallet size={14} /></Button>
          {r.document_status === 'not_issued' && (
            <Button size="sm" variant="ghost" disabled={pending} title="הוצא חשבונית בחשבונית ירוקה"
              onClick={() => start(async () => { const x = await requestInvoice(r.deal_id); if (x.ok) { window.open(x.url, '_blank'); notify('נפתחה חשבונית ירוקה — הסטטוס יתעדכן בייבוא הבא'); router.refresh() } else setError(x.error) })}><Receipt size={14} /></Button>
          )}
          {r.collection_status !== 'legal_collection' && r.days_overdue >= 90 && (
            <Button size="sm" variant="ghost" disabled={pending} title="העבר לטיפול משפטי"
              onClick={() => { if (confirm(`להעביר את ${r.client_name} לטיפול משפטי?`)) act(() => moveToLegal(r.deal_id), 'הועבר לטיפול משפטי') }}><Gavel size={14} /></Button>
          )}
        </span>
      ),
    },
  ]

  const tableRows = rows.map((r) => ({ ...r, id: r.deal_id }))

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      {/* 4 קוביות גיול — UIUX §5.7 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {aging.map((a) => (
          <KpiCard key={a.aging_bucket} title={`${a.aging_bucket} יום`} value={a.amount}
            certainty={a.aging_bucket === '0-30' ? 'committed' : undefined}
            nature={a.aging_bucket === '61-90' || a.aging_bucket === '90+' ? 'open' : undefined}
            subtitle={`${a.deal_count} תיקים · ודאי ${formatMoney(a.committed)}`}
            drillTitle={`גיול ${a.aging_bucket}`}
            drill={<ul className="divide-y divide-border text-sm">{rows.filter((r) => r.aging_bucket === a.aging_bucket).map((r) => <li key={r.deal_id} className="flex justify-between gap-2 py-2"><Link href={`/deals/${r.deal_id}`} className="underline truncate">{r.client_name}</Link><Money value={r.open_amount} /></li>)}{!rows.some((r) => r.aging_bucket === a.aging_bucket) && <li className="py-2 text-text-3">אין</li>}</ul>} />
        ))}
      </div>

      <div className="flex gap-1 border-b border-border">
        {([['aging', `גביה (${rows.length})`], ['execution', `לביצוע וגביה (${pipeline.length})`], ['flags', `דגלים (${flags.length})`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn('px-3 py-2 text-sm -mb-px border-b-2', tab === k ? 'border-brand text-text font-medium' : 'border-transparent text-text-2')}>{l}</button>
        ))}
      </div>
      {msg && <p className="text-sm text-actual" role="status">{msg}</p>}
      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      {tab === 'aging' && (
        <DataTable rows={tableRows} columns={columns} rowDivision={(r) => r.division as 'finance'} exportName="collections"
          primaryKeys={['client_name', 'open_amount', 'days_overdue']} emptyState="אין יתרות פתוחות — הכול נגבה" initialSort={{ key: 'days_overdue', dir: 'desc' }} />
      )}

      {tab === 'execution' && (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <h2 className="font-semibold text-sm">מה מעכב את הכסף — ברמת החברה</h2>
            <p className="text-xs text-text-3">ADDENDUM ב.5 — סה"כ {formatMoney(pipeline.reduce((a, p) => a + p.amount_at_stake, 0))} תקועים.</p>
            <ul className="flex flex-col gap-1 text-sm">
              {blockers.map((b) => (
                <li key={b.blocker} className="flex items-center gap-2">
                  <span className="w-40 truncate">{b.blocker}</span>
                  <span className="flex-1 h-2 bg-locked-bg rounded"><span className="block h-2 bg-expected rounded" style={{ width: `${Math.min(100, Number(b.pct_of_total) || 0)}%` }} /></span>
                  <span className="text-xs text-text-2 tnum w-28 text-start">{formatMoney(b.amount)} · {b.deal_count}</span>
                </li>
              ))}
              {!blockers.length && <li className="text-text-3">אין תיקים עם פריט חוסם</li>}
            </ul>
          </Card>
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-xs text-text-2 bg-locked-bg"><tr><th className="text-start p-2">לקוח</th><th className="text-end p-2">יתקבל בסיום</th><th className="text-start p-2">הפריט הבא שחסר</th><th className="text-start p-2">אחראי</th><th className="text-end p-2">תקוע</th><th className="text-end p-2">הושלם</th></tr></thead>
              <tbody>
                {pipeline.map((p) => (
                  <tr key={p.deal_id} className="border-t border-border hover:bg-locked-bg cursor-pointer" onClick={() => router.push(`/deals/${p.deal_id}`)}>
                    <td className="p-2">{p.client_name}</td>
                    <td className="p-2 text-end"><Money value={p.amount_at_stake} certainty="committed" /></td>
                    <td className="p-2">{p.next_missing ?? '—'}{p.next_status === 'blocked' && <span className="text-open text-xs"> · חסום: {p.blocked_reason}</span>}</td>
                    <td className="p-2 text-text-2">{p.owner_name ?? '—'}</td>
                    <td className={cn('p-2 text-end tnum', (p.stuck_days ?? 0) >= 7 && 'text-open font-medium')}>{p.stuck_days ?? 0} ימים</td>
                    <td className="p-2 text-end tnum">{Math.round(Number(p.completion_pct) || 0)}%</td>
                  </tr>
                ))}
                {!pipeline.length && <tr><td colSpan={6} className="p-4 text-center text-text-3">אין תיקים פתוחים עם צ׳קליסט</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === 'flags' && (
        <div className="flex flex-col gap-2">
          {!flags.length && <Card className="text-sm text-text-2">אין דגלים פתוחים.</Card>}
          {flags.map((f) => (
            <Card key={f.rule_key} className="flex flex-wrap items-center gap-2 text-sm border-s-4 border-s-expected">
              <AlertTriangle size={16} className="text-expected" />
              <span className="font-medium">{FLAG_LABEL[f.kind] ?? f.kind}</span>
              <span className="text-text-2">{f.subject}</span>
              <Money value={f.amount} nature="open" />
              <span className="text-xs text-text-3">{f.days} ימים</span>
              {f.deal_id && <Link href={`/deals/${f.deal_id}`} className="underline text-xs ms-auto">לתיק</Link>}
            </Card>
          ))}
        </div>
      )}

      {/* preview תזכורת — UIUX §5.7 */}
      <DrillDrawer open={Boolean(reminder)} onOpenChange={(o) => !o && setReminder(null)} title={reminder ? `תזכורת — ${reminder.row.client_name}` : ''}>
        {reminder && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm">
              <StatusPill tone={reminder.tone === 'friendly' ? 'actual' : reminder.tone === 'firm' ? 'expected' : 'open'}>
                {reminder.tone === 'friendly' ? 'ידידותי' : reminder.tone === 'firm' ? 'תקיף' : 'מוסלם'}
              </StatusPill>
              <span className="text-text-2">{formatMoney(reminder.row.open_amount)} · {reminder.row.days_overdue} ימי איחור</span>
            </div>
            <Field label="ההודעה שתישלח" hint="אפשר לערוך לפני שליחה">
              <Textarea name="message" defaultValue={reminder.whatsapp} rows={10} id="reminder-body" />
            </Field>
            <p className="text-xs text-text-3">
              {reminder.phone ? `וואטסאפ: ${reminder.phone}` : 'אין טלפון תקין בתיק'}
              {!reminder.hasWhatsApp && reminder.phone ? ' · Green-API לא מוגדר — ההודעה תמתין ב-outbox' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={pending || !reminder.phone}
                onClick={() => { const v = (document.getElementById('reminder-body') as HTMLTextAreaElement | null)?.value; act(async () => { const r = await sendReminder(reminder.row.deal_id, 'whatsapp', v); if (r.ok) setReminder(null); return r }, 'התזכורת נשלחה (או ממתינה ב-outbox)') }}>
                <MessageCircle size={16} /> שלח בוואטסאפ
              </Button>
              <Button disabled={pending}
                onClick={() => { const v = (document.getElementById('reminder-body') as HTMLTextAreaElement | null)?.value; act(async () => { const r = await sendReminder(reminder.row.deal_id, 'email', v ? `<div dir="rtl">${v.replace(/\n/g, '<br>')}</div>` : undefined); if (r.ok) setReminder(null); return r }, 'התזכורת נשלחה במייל (או ממתינה)') }}>
                <FileText size={16} /> שלח במייל
              </Button>
            </div>
          </div>
        )}
      </DrillDrawer>

      {/* סמן שולם */}
      <DrillDrawer open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)} title={paying ? `סמן שולם — ${paying.client_name}` : ''}>
        {paying && <MarkPaidForm row={paying} pending={pending} onDone={() => { setPaying(null); notify('התקבול נרשם'); router.refresh() }} onError={setError} />}
      </DrillDrawer>
    </div>
  )
}

function MarkPaidForm({ row, pending, onDone, onError }: { row: CollectionOpsRow; pending: boolean; onDone: () => void; onError: (e: string) => void }) {
  const [mode, setMode] = React.useState<'new' | 'existing'>('new')
  const [amount, setAmount] = React.useState(String(Math.round(row.open_amount)))
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [txId, setTxId] = React.useState('')
  const [candidates, setCandidates] = React.useState<{ id: string; date_cash: string; amount_net: number; counterparty: string | null; description: string | null }[]>([])
  const [busy, start] = React.useTransition()

  React.useEffect(() => {
    if (mode !== 'existing') return
    fetch(`/api/tx?unassigned=${Math.round(row.open_amount)}`).then((r) => r.json()).then((d) => setCandidates(d.rows ?? [])).catch(() => setCandidates([]))
  }, [mode, row.open_amount])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 text-sm">
        {([['new', 'תקבול חדש'], ['existing', 'שייך תנועה קיימת']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMode(k)} className={cn('px-3 py-1.5 rounded-[var(--radius-btn)] border', mode === k ? 'border-brand text-brand' : 'border-border text-text-2')}>{l}</button>
        ))}
      </div>
      {mode === 'new' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="סכום" required><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" /></Field>
          <Field label="תאריך" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
      ) : (
        <Field label="תנועת הכנסה ללא תיק" hint="תנועות בסכום דומה שנרשמו ולא שויכו">
          <Select value={txId} onChange={(e) => setTxId(e.target.value)}>
            <option value="">— בחרו —</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{formatDate(c.date_cash)} · {c.counterparty ?? c.description ?? '—'} · {formatMoney(c.amount_net)}</option>)}
          </Select>
        </Field>
      )}
      <Button variant="primary" disabled={pending || busy || (mode === 'existing' && !txId)}
        onClick={() => start(async () => {
          const r = await markPaid(row.deal_id, mode === 'new' ? { amount: Number(amount), date } : { txId })
          if (r.ok) onDone(); else onError(r.error)
        })}>
        <Check size={16} /> {mode === 'new' ? 'רשום תקבול' : 'שייך לתיק'}
      </Button>
      <p className="text-xs text-text-3">התקבול נרשם כתנועה רגילה (§2.1) ומשייך את התיק. אם היתרה נסגרת — סטטוס הגביה מתעדכן.</p>
    </div>
  )
}
