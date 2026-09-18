'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, CheckCheck, Copy, HelpCircle, Sparkles, Wand2, X } from 'lucide-react'
import { applyBatch, approveRows, cancelBatch, createRuleFrom, setImportRow } from '@/app/actions/imports'
import { DataTable, type Column } from '@/components/data-table'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DivisionPill, InvoicePill, StatusPill } from '@/components/status-pill'
import type { BatchRow, ImportRow } from '@/lib/queries/imports'
import type { CategoryRow } from '@/lib/queries/common'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

const INVOICE_CYCLE = ['unknown', 'has_invoice', 'missing', 'no_invoice_needed']
const selectClass = 'h-8 rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-xs'

/** "סוג" במסך האישור — SPEC §4.1: הוצאה / מקדמה-ניסים (כרטיס אישי) / פרטי. */
function kindOf(r: ImportRow): 'expense' | 'advance' | 'private' | 'income' {
  if (r.nature === 'income') return 'income'
  if (r.nature === 'advance') return 'advance'
  return r.division === 'private' ? 'private' : 'expense'
}

/** מסך 11 שלב 2 — UIUX §5.5: טבלת אישור עם ההצעה מ-rules, "אוטומטי ✓" / "לבדוק ?", עריכה בשורה. */
export function BatchReview({ batch, rows, categories, existing }: { batch: BatchRow; rows: ImportRow[]; categories: CategoryRow[]; existing: boolean }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [toast, setToast] = React.useState<string | null>(null)
  const [onlyToCheck, setOnlyToCheck] = React.useState(false)
  const meta = batch.meta!
  const editable = batch.status === 'review'

  function notify(msg: string) { setToast(msg); setTimeout(() => setToast(null), 8_000) }
  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: (r: { ok: true }) => void) {
    setError(null)
    start(async () => {
      const r = await fn()
      if (!r.ok) { setError(r.error); return }
      router.refresh()
      done?.(r)
    })
  }
  const patch = (id: string, p: Parameters<typeof setImportRow>[1]) => run(() => setImportRow(id, p))
  function setKind(r: ImportRow, kind: string) {
    if (kind === 'advance') patch(r.id, { nature: 'advance', division: 'finance', category_id: null })
    else if (kind === 'private') patch(r.id, { nature: 'expense', division: 'private', tx_class: 'private', deductible: false })
    else patch(r.id, { nature: 'expense', division: r.division === 'private' ? 'finance' : r.division, tx_class: r.tx_class === 'private' ? 'business' : r.tx_class, deductible: true })
  }

  const live = rows.filter((r) => r.decision !== 'duplicate')
  const auto = live.filter((r) => r.rule_id)
  const toCheck = live.filter((r) => !r.rule_id && !r.edited && r.decision !== 'skipped')
  const dups = rows.filter((r) => r.decision === 'duplicate')
  const written = live.filter((r) => r.decision !== 'skipped')
  const sum = Math.round(written.reduce((a, r) => a + r.amount, 0) * 100) / 100
  const approvable = live.filter((r) => r.decision === 'pending' && r.rule_id).length
  const filtered = onlyToCheck ? rows.filter((r) => toCheck.includes(r)) : rows

  const columns: Column<ImportRow>[] = [
    {
      key: 'decision', header: 'ייבוא', value: (r) => r.decision,
      cell: (r) => r.decision === 'duplicate'
        ? <StatusPill tone="locked" icon={Copy}>כבר קיים</StatusPill>
        : <input type="checkbox" aria-label="לייבא" checked={r.decision !== 'skipped'} disabled={!editable}
            onClick={(e) => e.stopPropagation()} onChange={(e) => patch(r.id, { decision: e.target.checked ? (r.rule_id ? 'approved' : 'pending') : 'skipped' })} />,
    },
    { key: 'date', header: 'תאריך', cell: (r) => formatDate(r.date) },
    { key: 'merchant', header: 'בית עסק', cell: (r) => <span className="font-medium" dir="auto">{r.merchant}{r.notes ? <span className="text-text-3 font-normal"> · {r.notes}</span> : null}</span> },
    { key: 'amount', header: 'סכום', align: 'end', cell: (r) => <Money value={r.amount} certainty={editable ? 'expected' : 'actual'} nature={r.decision === 'skipped' || r.decision === 'duplicate' ? 'locked' : undefined} />, footer: <Money value={sum} /> },
    {
      key: 'source', header: 'סיווג', value: (r) => r.rule_id ? 'אוטומטי' : r.edited ? 'ידני' : 'לבדוק',
      cell: (r) => r.rule_id
        ? <StatusPill tone="actual" icon={Check}>אוטומטי</StatusPill>
        : r.edited ? <StatusPill tone="committed" icon={Wand2}>ידני</StatusPill>
        : <StatusPill tone="open" icon={HelpCircle}>לבדוק</StatusPill>,
    },
    {
      key: 'kind', header: 'סוג', value: (r) => kindOf(r),
      cell: (r) => r.nature === 'income' ? <span className="text-xs text-text-2">זיכוי</span> : (
        <select value={kindOf(r)} disabled={!editable} onClick={(e) => e.stopPropagation()} onChange={(e) => setKind(r, e.target.value)} className={selectClass}>
          <option value="expense">הוצאה</option><option value="advance">מקדמה לניסים</option><option value="private">פרטי</option>
        </select>
      ),
    },
    {
      key: 'division', header: 'פעילות', value: (r) => r.division,
      cell: (r) => r.nature === 'advance' || r.division === 'private' ? <DivisionPill division={r.division} /> : (
        <select value={r.division} disabled={!editable} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(r.id, { division: e.target.value })} className={selectClass}>
          <option value="finance">מימון</option><option value="realestate">נדל"ן</option>
        </select>
      ),
    },
    {
      key: 'category_id', header: 'קטגוריה', value: (r) => r.category_name ?? '',
      cell: (r) => r.nature === 'advance' ? <span className="text-text-3">—</span> : (
        <select value={r.category_id ?? ''} disabled={!editable} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(r.id, { category_id: e.target.value || null })}
          className={cn(selectClass, 'max-w-[170px]', !r.category_id && r.nature === 'expense' && 'border-open')}>
          <option value="">— לבחור —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ),
    },
    {
      key: 'tx_class', header: 'עסקי/רכב', value: (r) => r.tx_class, mobileHidden: true,
      cell: (r) => r.division === 'private' || r.nature === 'advance' ? <span className="text-text-3">—</span> : (
        <select value={r.tx_class} disabled={!editable} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(r.id, { tx_class: e.target.value })} className={selectClass}>
          <option value="business">עסקי</option><option value="vehicle">רכב</option>
        </select>
      ),
    },
    {
      key: 'invoice_status', header: 'חשבונית', value: (r) => r.invoice_status, mobileHidden: true,
      cell: (r) => <InvoicePill status={r.invoice_status} onClick={editable ? () => patch(r.id, { invoice_status: INVOICE_CYCLE[(INVOICE_CYCLE.indexOf(r.invoice_status) + 1) % INVOICE_CYCLE.length] }) : undefined} />,
    },
    {
      key: 'review_status', header: 'לשאול', value: (r) => r.review_status, mobileHidden: true,
      cell: (r) => (
        <select value={r.review_status} disabled={!editable} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(r.id, { review_status: e.target.value })} className={selectClass}>
          <option value="ok">—</option><option value="ask_nissim">לשאול את ניסים</option><option value="ask_aviv">לשאול את אביב</option><option value="ask_yoni">לשאול את יוני</option><option value="unknown_expense">לא מזוהה</option>
        </select>
      ),
    },
    {
      key: 'rule', header: 'כלל', mobileHidden: true,
      cell: (r) => r.rule_id
        ? <span className="text-xs text-text-3 font-mono" dir="ltr">{r.matched_pattern}</span>
        : r.edited && (r.nature !== 'expense' || r.category_id)
          ? <Button size="sm" variant="ghost" disabled={pending} onClick={(e) => { e.stopPropagation(); run(() => createRuleFrom({ importRowId: r.id }), () => notify(`נוצר כלל: ${r.merchant.replace(/\d[\d./-]*/g, ' ').replace(/\s+/g, ' ').trim()}`)) }}>
              <Sparkles size={14} /> הפוך לכלל
            </Button>
          : null,
    },
  ]

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      {existing && <RiskLine icon={Copy}>הקובץ הזה כבר הועלה בעבר — מוצגת האצווה הקיימת. לא נוצרו שורות חדשות (SPEC §11.9).</RiskLine>}
      {meta.warnings.map((w) => <RiskLine key={w} icon={AlertTriangle}>{w}</RiskLine>)}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title={batch.status === 'applied' ? 'סכום החיוב (אב)' : 'סכום החיוב הצפוי (אב)'} value={sum} certainty={batch.status === 'applied' ? 'actual' : 'expected'}
          subtitle={sum === meta.parentAmount ? 'סכום הבנות = האב ✓' : `בקובץ: ${formatMoney(meta.parentAmount)} — ${written.length < live.length ? 'שורות שדולגו לא נכללות' : 'הפרש'}`}
          drillTitle="השורות שייכנסו" drill={<Lines rows={written} />} />
        <KpiCard title="אוטומטי ✓" value={auto.length} count certainty="actual" subtitle={`${live.length ? Math.round((auto.length / live.length) * 100) : 0}% מהשורות סווגו לפי כלל`} drillTitle="סווגו אוטומטית" drill={<Lines rows={auto} />} />
        <KpiCard title="לבדוק ?" value={toCheck.length} count nature={toCheck.length ? 'open' : undefined} subtitle="ללא כלל — ייכנסו כ'לא מזוהה' + משימה אם לא יסווגו" drillTitle="לבדוק" drill={<Lines rows={toCheck} />} />
        <KpiCard title="כפילויות" value={dups.length} count nature={dups.length ? 'locked' : undefined} subtitle="כבר קיימות במערכת מייבוא קודם — לא ייכנסו" drillTitle="כפילויות" drill={<Lines rows={dups} />} />
      </div>

      {batch.status === 'applied' && (
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm border-s-4 border-s-actual">
          <CheckCheck size={18} className="text-actual" />
          <span className="font-medium">{batch.rows_created - 1} יובאו</span>
          <span>· {batch.rows_skipped} דולגו / כפולות</span>
          <span>· {batch.rows_flagged} לבדיקה → משימות</span>
          <span>· סכום בנות = אב ✓</span>
          <Link href={`/transactions?period=${meta.billingDate.slice(0, 7)}`} className="underline ms-auto">לתנועות של {meta.billingDate.slice(0, 7)}</Link>
        </Card>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={pending || !written.length} onClick={() => run(() => applyBatch(batch.id), () => notify('הייבוא הוחל — האב והבנות נרשמו'))}>
            <CheckCheck size={16} /> החל ייבוא ({written.length})
          </Button>
          <Button disabled={pending || !approvable} onClick={() => run(() => approveRows(batch.id, 'auto'), () => notify(`אושרו ${approvable} שורות אוטומטיות`))}>
            <Check size={16} /> אשר את כל האוטומטיים ({approvable})
          </Button>
          <label className="inline-flex items-center gap-1 text-sm text-text-2 h-9 px-2">
            <input type="checkbox" checked={onlyToCheck} onChange={(e) => setOnlyToCheck(e.target.checked)} /> רק "לבדוק"
          </label>
          <Button variant="ghost" className="ms-auto" disabled={pending} onClick={() => { if (confirm('לבטל את האצווה? הקובץ יוכל לעלות שוב.')) run(() => cancelBatch(batch.id), () => router.push('/import')) }}>
            <X size={16} /> בטל אצווה
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      <DataTable
        rows={filtered}
        columns={columns}
        rowDivision={(r) => r.division as 'finance'}
        rowLocked={(r) => r.decision === 'duplicate' || r.decision === 'skipped'}
        exportName={`import-${batch.id.slice(0, 8)}`}
        primaryKeys={['merchant', 'amount', 'category_id']}
        emptyState="אין שורות"
      />

      {toast && <div role="status" className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-text text-surface text-sm px-4 py-2 rounded-[var(--radius-btn)] shadow-lg">{toast}</div>}
    </div>
  )
}

function Lines({ rows }: { rows: ImportRow[] }) {
  if (!rows.length) return <p className="text-sm text-text-3">אין</p>
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex justify-between gap-3 py-2">
          <span className="truncate">{formatDate(r.date)} · {r.merchant}{r.category_name ? ` · ${r.category_name}` : ''}</span>
          <Money value={r.amount} />
        </li>
      ))}
    </ul>
  )
}

function RiskLine({ icon: Icon, children }: { icon: typeof AlertTriangle; children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-sm text-expected bg-expected-bg rounded-[var(--radius-btn)] px-3 py-2"><Icon size={16} />{children}</div>
}
