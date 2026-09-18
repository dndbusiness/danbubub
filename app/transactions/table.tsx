'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { classifyTransaction } from '@/app/actions/transactions'
import { DataTable, type Column } from '@/components/data-table'
import { Money } from '@/components/money'
import { DivisionPill, InvoicePill, ReviewPill } from '@/components/status-pill'
import { NATURE_LABELS, formatDate } from '@/lib/ui/format'
import type { TxRow } from '@/lib/queries/transactions'
import type { CategoryRow } from '@/lib/queries/common'
import { cn } from '@/lib/ui/cn'

const INVOICE_CYCLE = ['unknown', 'has_invoice', 'missing', 'no_invoice_needed']

export function TransactionsTable({ rows, categories }: { rows: TxRow[]; categories: CategoryRow[] }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [natureFilter, setNature] = React.useState('all')
  const [onlyIssues, setOnlyIssues] = React.useState(false)

  function patch(id: string, p: Parameters<typeof classifyTransaction>[1]) {
    start(async () => { await classifyTransaction(id, p); router.refresh() })
  }

  const filtered = rows.filter((r) =>
    (natureFilter === 'all' || r.nature === natureFilter) &&
    (!onlyIssues || r.review_status !== 'ok' || r.invoice_status === 'missing' || r.invoice_status === 'unknown'),
  )

  const columns: Column<TxRow>[] = [
    { key: 'date_cash', header: 'תאריך', cell: (r) => formatDate(r.date_cash) },
    { key: 'nature', header: 'סוג', value: (r) => NATURE_LABELS[r.nature] ?? r.nature },
    { key: 'division', header: 'פעילות', cell: (r) => <DivisionPill division={r.division} /> },
    { key: 'counterparty', header: 'ספק / לקוח', cell: (r) => r.counterparty ?? r.deal_client ?? <span className="text-text-3">—</span> },
    { key: 'description', header: 'תיאור', cell: (r) => <span className="truncate max-w-[220px] inline-block align-bottom">{r.description ?? ''}</span> },
    {
      key: 'amount_net', header: 'סכום', align: 'end',
      cell: (r) => <Money value={r.amount_net} certainty="actual" nature={r.locked ? 'locked' : undefined} vat={{ net: r.amount_net, vat: r.vat_amount, gross: r.amount_gross }} />,
      footer: <Money value={filtered.reduce((a, r) => a + r.amount_net, 0)} />,
    },
    {
      key: 'category_name', header: 'קטגוריה',
      // UIUX §4.5 — ✎ עריכה בשורה. שינוי נשמר מיד.
      cell: (r) => r.locked ? (r.category_name ?? '—') : (
        <select
          value={r.category_id ?? ''}
          onChange={(e) => patch(r.id, { category_id: e.target.value || null })}
          onClick={(e) => e.stopPropagation()}
          className={cn('h-8 max-w-[160px] rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-xs', !r.category_id && r.nature === 'expense' && 'border-open')}
        >
          <option value="">— ללא —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ),
    },
    {
      key: 'deductible', header: 'מוכרת', value: (r) => r.deductible === null ? '' : r.deductible ? 'כן' : 'לא',
      cell: (r) => r.nature !== 'expense' ? <span className="text-text-3">—</span> : (
        <input type="checkbox" checked={Boolean(r.deductible)} disabled={r.locked} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(r.id, { deductible: e.target.checked })} />
      ),
    },
    {
      key: 'invoice_status', header: 'חשבונית',
      cell: (r) => <InvoicePill status={r.invoice_status} onClick={r.locked ? undefined : () => patch(r.id, { invoice_status: INVOICE_CYCLE[(INVOICE_CYCLE.indexOf(r.invoice_status) + 1) % INVOICE_CYCLE.length] })} />,
    },
    {
      key: 'review_status', header: 'סקירה',
      cell: (r) => r.locked ? <ReviewPill status={r.review_status} /> : (
        <select value={r.review_status} onChange={(e) => patch(r.id, { review_status: e.target.value })} onClick={(e) => e.stopPropagation()}
          className="h-8 rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-xs">
          <option value="ok">תקין</option><option value="ask_nissim">לשאול את ניסים</option><option value="ask_aviv">לשאול את אביב</option><option value="ask_yoni">לשאול את יוני</option><option value="unknown_expense">לא מזוהה</option>
        </select>
      ),
    },
  ]

  return (
    <div className={cn(pending && 'opacity-70')}>
      <DataTable
        rows={filtered}
        columns={columns}
        rowDivision={(r) => r.division as 'finance'}
        rowLocked={(r) => r.locked}
        exportName="transactions"
        primaryKeys={['date_cash', 'description', 'amount_net']}
        emptyState="אין תנועות בחודש זה"
        filters={
          <>
            <select value={natureFilter} onChange={(e) => setNature(e.target.value)} className="h-9 rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-sm">
              <option value="all">כל הסוגים</option>
              {Object.entries(NATURE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="inline-flex items-center gap-1 text-sm text-text-2 h-9 px-2">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> רק דורש טיפול
            </label>
          </>
        }
      />
    </div>
  )
}
