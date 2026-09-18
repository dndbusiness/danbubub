'use client'

import { useRouter } from 'next/navigation'
import { Check, Clock, FileCheck, XCircle } from 'lucide-react'
import { DataTable, type Column } from '@/components/data-table'
import { Money } from '@/components/money'
import { StatusPill } from '@/components/status-pill'
import { formatDate } from '@/lib/ui/format'
import type { BatchRow } from '@/lib/queries/imports'

function BatchStatus({ status }: { status: string }) {
  if (status === 'applied') return <StatusPill tone="actual" icon={Check}>יובא</StatusPill>
  if (status === 'review') return <StatusPill tone="expected" icon={Clock}>ממתין לאישור</StatusPill>
  if (status === 'cancelled') return <StatusPill tone="locked" icon={XCircle}>בוטל</StatusPill>
  return <StatusPill tone="neutral" icon={FileCheck}>{status}</StatusPill>
}

export function BatchesTable({ rows }: { rows: BatchRow[] }) {
  const router = useRouter()
  const columns: Column<BatchRow>[] = [
    { key: 'created_at', header: 'הועלה', cell: (r) => formatDate(r.created_at.slice(0, 10)) },
    { key: 'file_name', header: 'קובץ', cell: (r) => <span className="truncate max-w-[220px] inline-block align-bottom" dir="ltr">{r.file_name}</span> },
    { key: 'account_name', header: 'כרטיס', value: (r) => r.account_name ?? '' },
    { key: 'format', header: 'פורמט', value: (r) => r.meta?.formatLabel ?? '' },
    { key: 'billing', header: 'יום חיוב', value: (r) => r.meta?.billingDate ?? '', cell: (r) => r.meta ? formatDate(r.meta.billingDate) : '—' },
    { key: 'parent', header: 'סכום החיוב', align: 'end', value: (r) => r.meta?.parentAmount ?? 0, cell: (r) => r.meta ? <Money value={r.meta.parentAmount} certainty={r.status === 'applied' ? 'actual' : 'expected'} /> : '—' },
    { key: 'rows_total', header: 'שורות', value: (r) => r.rows_total, mobileHidden: true },
    { key: 'rows_flagged', header: 'לבדוק', value: (r) => r.rows_flagged, cell: (r) => r.rows_flagged ? <span className="text-open font-medium">{r.rows_flagged}</span> : <span className="text-text-3">0</span>, mobileHidden: true },
    { key: 'status', header: 'מצב', value: (r) => r.status, cell: (r) => <BatchStatus status={r.status} /> },
  ]
  return (
    <DataTable
      rows={rows}
      columns={columns}
      onRowClick={(r) => router.push(`/import/${r.id}`)}
      exportName="import-batches"
      primaryKeys={['file_name', 'parent', 'status']}
      emptyState="עדיין לא יובא קובץ אשראי"
    />
  )
}
