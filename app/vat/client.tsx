'use client'

import * as React from 'react'
import { Percent } from 'lucide-react'
import { DataTable, type Column } from '@/components/data-table'
import { DrillDrawer } from '@/components/drill-drawer'
import { Money } from '@/components/money'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/status-pill'
import type { VatPeriodRow } from '@/lib/queries/vat'
import { formatDate, formatMoney } from '@/lib/ui/format'

type Line = { id: string; date: string; counterparty: string | null; description: string | null; amount_gross: number; vat_amount: number; invoice_status: string; category_name: string | null }

/** מסך 10 — מע"מ (§3.1). כל מספר נפתח לשורות שמרכיבות אותו (§11.7). */
export function VatView({ rows }: { rows: VatPeriodRow[] }) {
  const [drill, setDrill] = React.useState<{ title: string; period: string; kind: string } | null>(null)
  const [lines, setLines] = React.useState<Line[] | null>(null)

  React.useEffect(() => {
    if (!drill) { setLines(null); return }
    setLines(null)
    fetch(`/api/vat/lines?period=${encodeURIComponent(drill.period)}&kind=${drill.kind}`)
      .then((r) => r.json()).then((d) => setLines(d.rows ?? [])).catch(() => setLines([]))
  }, [drill])

  const open = (title: string, period: string, kind: string) => setDrill({ title, period, kind })

  const columns: Column<VatPeriodRow & { id: string }>[] = [
    { key: 'period', header: 'תקופת דיווח', cell: (r) => <span className="font-medium">{r.period}</span> },
    { key: 'output_vat', header: 'מע"מ עסקאות', align: 'end', cell: (r) => <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); open(`מע"מ עסקאות ${r.period}`, r.period, 'output') }}><Money value={r.output_vat} certainty="actual" /></button> },
    { key: 'input_vat_claimable', header: 'תשומות עם חשבונית', align: 'end', cell: (r) => <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); open(`תשומות ${r.period}`, r.period, 'input_claimable') }}><Money value={-r.input_vat_claimable} /></button> },
    { key: 'liability', header: 'לתשלום', align: 'end', cell: (r) => <Money value={r.liability} certainty="committed" nature={r.liability < 0 ? undefined : 'open'} />, footer: null },
    {
      key: 'input_vat_missing_invoice', header: 'תשומות ללא חשבונית', align: 'end',
      cell: (r) => r.missing_invoice_count === 0
        ? <span className="text-text-3">—</span>
        : <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); open(`תשומות ללא חשבונית ${r.period}`, r.period, 'input_missing') }}>
            <span className="inline-flex items-center gap-1"><Money value={r.input_vat_missing_invoice} nature="open" /><StatusPill tone="open">{r.missing_invoice_count}</StatusPill></span>
          </button>,
    },
  ]

  return (
    <>
      <DataTable rows={rows.map((r) => ({ ...r, id: r.period }))} columns={columns} exportName="vat"
        primaryKeys={['period', 'liability', 'input_vat_missing_invoice']} emptyState="אין נתוני מע״מ" />

      <DrillDrawer open={Boolean(drill)} onOpenChange={(o) => !o && setDrill(null)} title={drill?.title ?? ''}>
        {!lines ? <p className="text-sm text-text-3">טוען…</p> : !lines.length ? <p className="text-sm text-text-3">אין שורות</p> : (
          <ul className="divide-y divide-border text-sm">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 py-2">
                <span className="truncate">{formatDate(l.date)} · {l.counterparty ?? l.description ?? '—'}{l.category_name ? <span className="text-text-3"> · {l.category_name}</span> : null}</span>
                <span className="flex gap-3 shrink-0"><span className="text-text-3 text-xs self-center">{formatMoney(l.amount_gross)}</span><Money value={l.vat_amount} /></span>
              </li>
            ))}
            <li className="flex justify-between pt-2 font-medium"><span>סה״כ מע״מ</span><Money value={lines.reduce((a, l) => a + l.vat_amount, 0)} /></li>
          </ul>
        )}
      </DrillDrawer>
    </>
  )
}

export function VatHeader({ next, bimonthly }: { next: { date: string; period: string; amount: number } | null; bimonthly: boolean }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 text-sm">
      <Percent size={16} className="text-text-2" />
      <span>דיווח {bimonthly ? 'דו-חודשי' : 'חודשי'}</span>
      {next ? (
        <>
          <span className="text-text-2">התשלום הבא: {formatDate(next.date)} על {next.period}</span>
          <Money value={next.amount} certainty="committed" nature={next.amount > 0 ? 'open' : undefined} />
          <span className="text-xs text-text-3">נכנס אוטומטית ללוח החיובים בתזרים</span>
        </>
      ) : <span className="text-text-3">אין עדיין תקופה סגורה לדיווח</span>}
    </Card>
  )
}
