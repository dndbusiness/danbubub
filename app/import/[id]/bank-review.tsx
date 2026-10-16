'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCheck, Copy, Landmark, Link2, Plus, X } from 'lucide-react'
import { applyBankBatch, cancelBatch, setBankMatch, setImportRow } from '@/app/actions/imports'
import { DataTable, type Column } from '@/components/data-table'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/status-pill'
import type { BatchRow, ImportRow } from '@/lib/queries/imports'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

const selectClass = 'h-8 rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-xs max-w-[220px]'

/**
 * מסך 11 — אישור דף בנק (SPEC §4.2). ההבדל מאשראי: כאן לא מסווגים קטגוריות,
 * אלא מכריעים מה כבר קיים במערכת (שידוך) ומה תנועה חדשה.
 */
export function BankBatchReview({ batch, rows, existing }: { batch: BatchRow; rows: ImportRow[]; existing: boolean }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [toast, setToast] = React.useState<string | null>(null)
  const [onlyOpen, setOnlyOpen] = React.useState(false)
  const meta = batch.meta!
  const editable = batch.status === 'review'

  function notify(msg: string) { setToast(msg); setTimeout(() => setToast(null), 8_000) }
  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) {
    setError(null)
    start(async () => { const r = await fn(); if (!r.ok) { setError(r.error); return } router.refresh(); done?.() })
  }

  const live = rows.filter((r) => r.decision !== 'duplicate')
  const dups = rows.filter((r) => r.decision === 'duplicate')
  const matched = live.filter((r) => r.matched_tx_id)
  const withCandidates = live.filter((r) => !r.matched_tx_id && r.match_status === 'candidates')
  const newRows = live.filter((r) => !r.matched_tx_id && r.match_status !== 'candidates' && r.decision !== 'skipped')
  const written = live.filter((r) => r.decision !== 'skipped')
  const sum = Math.round(written.reduce((a, r) => a + r.amount, 0) * 100) / 100
  const filtered = onlyOpen ? rows.filter((r) => !r.matched_tx_id && r.decision !== 'duplicate') : rows

  const balanceOk = meta.balanceMatches === true
  const balanceChecked = meta.closingBalance !== null && meta.closingBalance !== undefined

  const columns: Column<ImportRow>[] = [
    {
      key: 'decision', header: 'ייבוא', value: (r) => r.decision,
      cell: (r) => r.decision === 'duplicate'
        ? <StatusPill tone="locked" icon={Copy}>כבר קיים</StatusPill>
        : <input type="checkbox" aria-label="לייבא" checked={r.decision !== 'skipped'} disabled={!editable}
            onClick={(e) => e.stopPropagation()} onChange={(e) => run(() => setImportRow(r.id, { decision: e.target.checked ? 'pending' : 'skipped' }))} />,
    },
    { key: 'date', header: 'תאריך', cell: (r) => formatDate(r.date) },
    { key: 'merchant', header: 'תיאור', cell: (r) => <span className="font-medium" dir="auto">{r.merchant}{r.notes ? <span className="text-text-3 font-normal"> · {r.notes}</span> : null}</span> },
    { key: 'reference', header: 'אסמכתא', mobileHidden: true, cell: (r) => <span className="text-xs text-text-3" dir="ltr">{r.reference ?? '—'}</span> },
    { key: 'amount', header: 'סכום', align: 'end', cell: (r) => <Money value={r.amount} certainty={batch.status === 'applied' ? 'actual' : 'expected'} nature={r.decision === 'skipped' || r.decision === 'duplicate' ? 'locked' : undefined} />, footer: <Money value={sum} /> },
    { key: 'balance', header: 'יתרה בדף', align: 'end', mobileHidden: true, value: (r) => r.balance ?? 0, cell: (r) => r.balance === null ? <span className="text-text-3">—</span> : <span className="tnum text-xs text-text-2">{formatMoney(r.balance)}</span> },
    {
      key: 'match', header: 'שידוך לתנועה קיימת', value: (r) => r.match_status,
      cell: (r) => {
        if (r.decision === 'duplicate') return <span className="text-text-3">—</span>
        const options = r.match_candidates ?? []
        if (!options.length && !r.matched_tx_id) return <StatusPill tone="committed" icon={Plus}>תנועה חדשה</StatusPill>
        return (
          <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <select value={r.matched_tx_id ?? ''} disabled={!editable} className={cn(selectClass, r.matched_tx_id && 'border-actual')}
              onChange={(e) => run(() => setBankMatch(r.id, e.target.value || null))}>
              <option value="">תנועה חדשה</option>
              {options.map((c) => (
                <option key={c.txId} value={c.txId}>
                  {formatDate(c.date)} · {formatMoney(c.amount)} · {c.label ?? '—'} ({Math.round(c.score * 100)}%)
                </option>
              ))}
              {r.matched_tx_id && !options.some((c) => c.txId === r.matched_tx_id) && <option value={r.matched_tx_id}>שודך</option>}
            </select>
            {r.matched_tx_id ? <StatusPill tone="actual" icon={Link2}>שודך</StatusPill> : null}
          </span>
        )
      },
    },
  ]

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      {existing && <RiskLine icon={Copy}>הקובץ הזה כבר הועלה בעבר — מוצגת האצווה הקיימת. לא נוצרו שורות חדשות (SPEC §11.9).</RiskLine>}
      {meta.warnings.map((w) => <RiskLine key={w} icon={AlertTriangle}>{w}</RiskLine>)}

      <Card className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-sm border-s-4', balanceOk ? 'border-s-actual' : balanceChecked ? 'border-s-open' : 'border-s-locked')}>
        <Landmark size={18} className={balanceOk ? 'text-actual' : balanceChecked ? 'text-open' : 'text-text-3'} />
        {!balanceChecked ? (
          <span className="text-text-2">בקובץ אין עמודת יתרה — אי אפשר לאמת את הסגירה. השורות עצמן נקלטות כרגיל.</span>
        ) : balanceOk ? (
          <>
            <span className="font-medium">היתרה מסתדרת ✓</span>
            <span className="text-text-2">פתיחה {formatMoney(meta.openingBalance ?? 0)} + התנועות = סגירה {formatMoney(meta.closingBalance ?? 0)}</span>
          </>
        ) : (
          <>
            <span className="font-medium text-open">היתרה לא מסתדרת — הפרש {formatMoney(meta.balanceGap ?? 0)}</span>
            <span className="text-text-2">לפי השורות {formatMoney(meta.computedClosing ?? 0)} · בדף {formatMoney(meta.closingBalance ?? 0)}</span>
            {meta.firstBalanceBreak && (
              <span className="w-full text-xs text-text-3">
                השבירה הראשונה בשורה {meta.firstBalanceBreak.rowIndex + 1} — {meta.firstBalanceBreak.description}: ציפינו {formatMoney(meta.firstBalanceBreak.expected)}, בדף {formatMoney(meta.firstBalanceBreak.found)}. כנראה חסרה שם שורה בקובץ.
              </span>
            )}
          </>
        )}
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="תנועה בדף" value={sum} certainty={batch.status === 'applied' ? 'actual' : 'expected'}
          subtitle={`${live.length} שורות · ${formatDate(meta.dateFrom)}–${formatDate(meta.dateTo)}`}
          drillTitle="השורות שייכנסו" drill={<Lines rows={written} />} />
        <KpiCard title="שודכו לתנועה קיימת" value={matched.length} count certainty="actual"
          subtitle="לא ייווצרו מחדש — רק יסומנו כמאומתות מול הבנק" drillTitle="שודכו" drill={<Lines rows={matched} />} />
        <KpiCard title="להכריע" value={withCandidates.length} count nature={withCandidates.length ? 'open' : undefined}
          subtitle="יש מועמד אפשרי — צריך לבחור או להשאיר כתנועה חדשה" drillTitle="להכריע" drill={<Lines rows={withCandidates} />} />
        <KpiCard title="תנועות חדשות" value={newRows.length} count certainty={newRows.length ? 'committed' : undefined}
          subtitle="ייכנסו כ'לא מזוהה' + משימת סיווג" drillTitle="חדשות" drill={<Lines rows={newRows} />} />
      </div>

      {batch.status === 'applied' && (
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm border-s-4 border-s-actual">
          <CheckCheck size={18} className="text-actual" />
          <span className="font-medium">{batch.rows_created} תנועות חדשות</span>
          <span>· {matched.length} שודכו לקיימות</span>
          <span>· {batch.rows_skipped} דולגו / כפולות</span>
          <Link href={`/transactions?period=${meta.dateTo.slice(0, 7)}`} className="underline ms-auto">לתנועות של {meta.dateTo.slice(0, 7)}</Link>
        </Card>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={pending || !written.length} onClick={() => run(() => applyBankBatch(batch.id), () => notify('דף הבנק הוחל'))}>
            <CheckCheck size={16} /> החל ייבוא ({written.length})
          </Button>
          <label className="inline-flex items-center gap-1 text-sm text-text-2 h-9 px-2">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> רק מה שלא שודך
          </label>
          <Button variant="ghost" className="ms-auto" disabled={pending} onClick={() => { if (confirm('לבטל את האצווה? הקובץ יוכל לעלות שוב.')) run(() => cancelBatch(batch.id), () => router.push('/import')) }}>
            <X size={16} /> בטל אצווה
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      <DataTable rows={filtered} columns={columns} rowLocked={(r) => r.decision === 'duplicate' || r.decision === 'skipped'}
        exportName={`bank-${batch.id.slice(0, 8)}`} primaryKeys={['date', 'merchant', 'amount']} emptyState="אין שורות" />

      {toast && <div role="status" className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-text text-surface text-sm px-4 py-2 rounded-[var(--radius-btn)] shadow-lg">{toast}</div>}
      <p className="text-xs text-text-3">{dups.length ? `${dups.length} שורות כבר יובאו בעבר ולא ייכנסו שוב (SPEC §11.9).` : 'אין שורות כפולות.'}</p>
    </div>
  )
}

function Lines({ rows }: { rows: ImportRow[] }) {
  if (!rows.length) return <p className="text-sm text-text-3">אין</p>
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex justify-between gap-3 py-2">
          <span className="truncate">{formatDate(r.date)} · {r.merchant}</span>
          <Money value={r.amount} />
        </li>
      ))}
    </ul>
  )
}

function RiskLine({ icon: Icon, children }: { icon: typeof AlertTriangle; children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-sm text-expected bg-expected-bg rounded-[var(--radius-btn)] px-3 py-2"><Icon size={16} />{children}</div>
}
