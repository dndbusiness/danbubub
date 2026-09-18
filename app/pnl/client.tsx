'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DataTable, type Column } from '@/components/data-table'
import { DrillDrawer } from '@/components/drill-drawer'
import { Money } from '@/components/money'
import { Card, CardTitle } from '@/components/ui/card'
import { txByIds } from '@/lib/queries/pnl'
import type { PnlLine, PnlMode } from '@/lib/queries/pnl'
import { formatMonth } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

type Line = PnlLine & { txIds: string[]; id?: string }

/** SPEC §3.2 — "מתג בין שתי ההגדרות, כותרת ברורה איזו מוצגת." */
export function PnlView({ mode }: { mode: PnlMode }) {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams()
  const set = (m: PnlMode) => { const p = new URLSearchParams(params.toString()); p.set('mode', m); router.push(`${pathname}?${p}`) }
  return (
    <div role="tablist" className="inline-flex rounded-[var(--radius-btn)] border border-border bg-surface h-10 p-0.5 gap-0.5 self-start">
      {([['distributable', 'רווח לחלוקה — הסכם השותפות'], ['operational', 'רווח תפעולי — מה נשאר בקופה']] as const).map(([k, l]) => (
        <button key={k} role="tab" type="button" aria-selected={mode === k} onClick={() => set(k)}
          className={cn('px-4 rounded-[6px] text-sm', mode === k ? 'bg-text text-surface' : 'text-text-2 hover:bg-locked-bg')}>{l}</button>
      ))}
    </div>
  )
}

export function PnlTables({ income, expenses, byMonth, currentMonth }: { income: Line[]; expenses: Line[]; byMonth: { month: string; operational: number; distributable: number }[]; currentMonth: string }) {
  const [drill, setDrill] = React.useState<{ title: string; amount: number; rows: Awaited<ReturnType<typeof txByIds>> } | null>(null)

  async function open(line: Line) {
    // ה-drill קורא server function ישירות — הפונקציה מסומנת בקובץ 'use server'? לא: היא query; עוטפים ב-route קטן.
    const res = await fetch(`/api/tx?ids=${line.txIds.join(',')}`)
    const rows = (await res.json()) as Awaited<ReturnType<typeof txByIds>>
    setDrill({ title: line.label, amount: line.amount, rows })
  }

  const cols: Column<Line & { id: string }>[] = [
    { key: 'label', header: 'שורה' },
    { key: 'count', header: 'תנועות', cell: (r) => <span className="tnum text-text-2">{r.count}</span> },
    { key: 'amount', header: 'סכום', align: 'end', cell: (r) => <Money value={r.amount} /> },
  ]
  const max = Math.max(1, ...byMonth.map((m) => Math.max(Math.abs(m.operational), Math.abs(m.distributable))))

  return (
    <>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardTitle className="mb-2">הכנסות לפי תיק</CardTitle>
          <DataTable rows={income.map((r) => ({ ...r, id: r.key }))} columns={cols} onRowClick={open} exportName="pnl-income" emptyState="אין הכנסות בחודש" />
        </Card>
        <Card>
          <CardTitle className="mb-2">הוצאות לפי קטגוריה</CardTitle>
          <DataTable rows={expenses.map((r) => ({ ...r, id: r.key }))} columns={cols} onRowClick={open} exportName="pnl-expenses" emptyState="אין הוצאות בחודש" />
        </Card>
      </div>

      {/* UIUX §5.1 — "רווח לחלוקה לפי חודש" — עמודות; קו/עמודה בלבד, בלי גרדיאנטים (§4.7) */}
      <Card>
        <CardTitle className="mb-3">רווח לפי חודש — לחלוקה (כחול) מול תפעולי (אפור)</CardTitle>
        <div className="flex items-end gap-3 h-40" dir="ltr">
          {byMonth.map((m) => (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${formatMonth(m.month)}: לחלוקה ${m.distributable.toLocaleString('he-IL')} · תפעולי ${m.operational.toLocaleString('he-IL')}`}>
              <div className="flex items-end gap-0.5 w-full h-full justify-center">
                <div className={cn('w-4 rounded-t', m.distributable >= 0 ? 'bg-committed' : 'bg-open')} style={{ height: `${(Math.abs(m.distributable) / max) * 100}%` }} />
                <div className="w-4 rounded-t bg-locked" style={{ height: `${(Math.abs(m.operational) / max) * 100}%` }} />
              </div>
              <span className={cn('text-[10px] tnum', m.month === currentMonth ? 'text-text font-medium' : 'text-text-3')}>{formatMonth(m.month, { short: true })}</span>
            </div>
          ))}
        </div>
      </Card>

      <DrillDrawer open={drill !== null} onOpenChange={(o) => !o && setDrill(null)} title={drill?.title ?? ''} amount={drill && <Money value={drill.amount} size="lg" />} breadcrumb={['רווח והפסד', formatMonth(currentMonth)]}>
        {drill && (
          <DataTable rows={drill.rows} columns={[
            { key: 'date', header: 'תאריך' }, { key: 'counterparty', header: 'ספק / לקוח' }, { key: 'label', header: 'תיאור' },
            { key: 'amount', header: 'סכום', align: 'end', cell: (r) => <Money value={r.amount} certainty="actual" /> },
          ]} exportName="pnl-drill" />
        )}
      </DrillDrawer>
    </>
  )
}
