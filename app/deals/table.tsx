'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DataTable, type Column } from '@/components/data-table'
import { Money } from '@/components/money'
import { CollectionPill, StatusPill } from '@/components/status-pill'
import { FINANCE_STAGE_LABELS, PRODUCT_LABELS, formatDate } from '@/lib/ui/format'
import type { DealRow } from '@/lib/queries/deals'
import { cn } from '@/lib/ui/cn'

/** UIUX §5.2 — טאבים: הכל / פוטנציאל / ודאי / שולם חלקית / לביצוע וגביה / הושלם. */
const TABS: { key: string; label: string; filter: (d: DealRow) => boolean }[] = [
  { key: 'all', label: 'הכל', filter: () => true },
  { key: 'potential', label: 'פוטנציאל', filter: (d) => d.status === 'open' && ['prospect', 'signed_collecting_docs', 'submitted'].includes(d.stage) },
  { key: 'certain', label: 'ודאי', filter: (d) => d.status === 'open' && d.open_committed > 0 },
  { key: 'partial', label: 'שולם חלקית', filter: (d) => d.collected_net > 0 && d.open_balance_net > 0 },
  { key: 'execution', label: 'לביצוע וגביה', filter: (d) => d.status !== 'lost' && d.status !== 'cancelled' && d.next_missing !== null },
  { key: 'done', label: 'הושלם', filter: (d) => d.stage === 'completed' || d.collection_status === 'fully_paid' },
]

export function DealsTable({ deals, tab }: { deals: (DealRow & { id?: string })[]; tab: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const active = TABS.find((t) => t.key === tab) ?? TABS[0]!
  const rows = deals.filter(active.filter).map((d) => ({ ...d, id: d.deal_id }))

  function setTab(key: string) {
    const p = new URLSearchParams(params.toString()); p.set('tab', key)
    router.push(`${pathname}?${p.toString()}`)
  }

  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'client_name', header: 'לקוח', cell: (r) => <Link href={`/deals/${r.deal_id}`} className="font-medium hover:underline">{r.client_name}</Link> },
    { key: 'product', header: 'מוצר', value: (r) => PRODUCT_LABELS[r.product] ?? r.product },
    { key: 'stage', header: 'שלב', value: (r) => FINANCE_STAGE_LABELS[r.stage] ?? r.stage, cell: (r) => <StatusPill tone={r.stage === 'completed' ? 'actual' : 'committed'}>{FINANCE_STAGE_LABELS[r.stage] ?? r.stage}</StatusPill> },
    { key: 'collection_status', header: 'גביה', cell: (r) => <CollectionPill status={r.collection_status} /> },
    { key: 'fee_agreed_net', header: 'שכ״ט', align: 'end', cell: (r) => <Money value={r.fee_agreed_net} />, footer: <Money value={rows.reduce((a, r) => a + r.fee_agreed_net, 0)} /> },
    { key: 'collected_net', header: 'נגבה', align: 'end', cell: (r) => <Money value={r.collected_net} certainty="actual" />, footer: <Money value={rows.reduce((a, r) => a + r.collected_net, 0)} certainty="actual" /> },
    {
      key: 'open_balance_net', header: 'פתוח', align: 'end',
      // UIUX §5.2 — "פתוח (כחול/כתום מפוצל בתא)"
      cell: (r) => (
        <span className="inline-flex gap-2">
          {r.open_committed > 0 && <Money value={r.open_committed} certainty="committed" />}
          {r.open_expected_weighted > 0 && <Money value={r.open_expected_weighted} certainty="expected" />}
          {r.open_committed === 0 && r.open_expected_weighted === 0 && r.open_balance_net > 0 && <Money value={r.open_balance_net} nature="open" />}
        </span>
      ),
      footer: <Money value={rows.reduce((a, r) => a + r.open_balance_net, 0)} nature="open" />,
    },
    { key: 'direct_costs_net', header: 'ישירות', align: 'end', cell: (r) => <Money value={r.direct_costs_net} nature="open" /> },
    { key: 'net_contribution', header: 'תרומה', align: 'end', cell: (r) => <Money value={r.net_contribution} /> },
    { key: 'lead_source', header: 'ערוץ', mobileHidden: true },
    { key: 'owner_name', header: 'אחראי', mobileHidden: true },
    { key: 'last_activity_at', header: 'עדכון', value: (r) => r.last_activity_at ?? '', cell: (r) => formatDate(r.last_activity_at) },
    { key: 'next_missing', header: 'הבא שחסר', cell: (r) => r.next_missing ? <span className="text-expected text-xs">{r.next_missing}</span> : <span className="text-text-3 text-xs">—</span> },
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      onRowClick={(r) => router.push(`/deals/${r.deal_id}`)}
      rowDivision={() => 'finance'}
      exportName="deals"
      primaryKeys={['client_name', 'stage', 'open_balance_net']}
      emptyState="עדיין אין תיקים — ייבא מ-WISE או הוסף ידנית"
      filters={
        <div role="tablist" className="inline-flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t.key} role="tab" type="button" aria-selected={active.key === t.key} onClick={() => setTab(t.key)}
              className={cn('h-9 px-3 rounded-[var(--radius-btn)] text-sm', active.key === t.key ? 'bg-text text-surface' : 'bg-surface border border-border text-text-2 hover:bg-locked-bg')}>
              {t.label} <span className="text-xs opacity-60">{deals.filter(t.filter).length}</span>
            </button>
          ))}
        </div>
      }
    />
  )
}
