'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import type { Division } from '@/components/ui/card'

export interface Column<Row> {
  key: string
  header: string
  /** תא. ברירת מחדל: הערך בשדה `key`. */
  cell?: (row: Row) => React.ReactNode
  /** ערך למיון/ייצוא. ברירת מחדל: הערך בשדה `key`. */
  value?: (row: Row) => string | number | null | undefined
  /** עמודות ₪ מיושרות לשמאל (UIUX §4.5). */
  align?: 'start' | 'end'
  /** שורת סיכום. */
  footer?: React.ReactNode
  className?: string
  /** מוסתר בנייד — הופך ל"עוד" (UIUX §3.2). */
  mobileHidden?: boolean
}

/**
 * <DataTable> — UIUX §4.5.
 * כותרת דביקה, מיון בלחיצה, חיפוש חופשי, 25/50/100 בעמוד, ייצוא CSV,
 * פס division בצד, לחיצה על שורה, שורת סיכום, שורה נעולה.
 * בנייד: השורות הופכות לכרטיסים עם 3 שדות עיקריים (UIUX §3.2).
 */
export function DataTable<Row extends { id: string }>({
  rows,
  columns,
  onRowClick,
  rowDivision,
  rowLocked,
  emptyState,
  exportName = 'export',
  initialSort,
  filters,
  primaryKeys,
  className,
}: {
  rows: Row[]
  columns: Column<Row>[]
  onRowClick?: (row: Row) => void
  rowDivision?: (row: Row) => Division | undefined
  /** שורה בתקופה נעולה — רקע אפור, 🔒 (UIUX §4.5). */
  rowLocked?: (row: Row) => boolean
  emptyState?: React.ReactNode
  exportName?: string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  /** פילטרים מעל הטבלה (UIUX §4.5 "פילטרים בשורה מעל"). */
  filters?: React.ReactNode
  /** 3 העמודות שמוצגות בכרטיס בנייד. ברירת מחדל: שלוש הראשונות. */
  primaryKeys?: string[]
  className?: string
}) {
  const [query, setQuery] = React.useState('')
  const [sort, setSort] = React.useState(initialSort ?? null)
  const [pageSize, setPageSize] = React.useState(25)
  const [page, setPage] = React.useState(0)

  const valueOf = React.useCallback(
    (row: Row, col: Column<Row>) =>
      col.value ? col.value(row) : ((row as Record<string, unknown>)[col.key] as string | number | null | undefined),
    [],
  )

  const filtered = React.useMemo(() => {
    if (!query.trim()) return rows
    const q = query.trim().toLowerCase()
    return rows.filter((row) =>
      columns.some((col) => String(valueOf(row, col) ?? '').toLowerCase().includes(q)),
    )
  }, [rows, columns, query, valueOf])

  const sorted = React.useMemo(() => {
    if (!sort) return filtered
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return filtered
    return [...filtered].sort((a, b) => {
      const va = valueOf(a, col) ?? ''
      const vb = valueOf(b, col) ?? ''
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'he')
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sort, columns, valueOf])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize)
  const primary = primaryKeys ?? columns.slice(0, 3).map((c) => c.key)

  function toggleSort(key: string) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  function exportCsv() {
    const header = columns.map((c) => `"${c.header}"`).join(',')
    const body = sorted.map((row) => columns.map((c) => `"${String(valueOf(row, c) ?? '').replace(/"/g, '""')}"`).join(','))
    const blob = new Blob(['﻿' + [header, ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${exportName}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const stripe: Record<Division, string> = {
    realestate: 'border-e-div-realestate',
    finance: 'border-e-div-finance',
    shared: 'border-e-div-shared',
    private: 'border-e-div-private',
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* פילטרים + חיפוש + ייצוא — שורה עליונה */}
      <div className="flex flex-wrap items-center gap-2">
        {filters}
        <div className="relative ms-auto">
          <Search size={14} className="absolute top-1/2 -translate-y-1/2 end-3 text-text-3" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0) }}
            placeholder="חיפוש…"
            className="h-9 w-44 rounded-[var(--radius-btn)] border border-border bg-surface pe-8 ps-3 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="h-9 px-3 inline-flex items-center gap-1 text-xs text-text-2 rounded-[var(--radius-btn)] border border-border bg-surface hover:bg-locked-bg"
          title="ייצוא CSV"
        >
          <Download size={14} /> ייצוא
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-surface rounded-[var(--radius-card)] border border-border p-8 text-center text-text-2 text-sm">
          {emptyState ?? 'אין שורות להצגה'}
        </div>
      ) : (
        <>
          {/* דסקטופ / טאבלט: טבלה */}
          <div className="hidden md:block bg-surface rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-border">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        'px-3 py-2.5 text-xs font-medium text-text-2 cursor-pointer select-none whitespace-nowrap',
                        col.align === 'end' ? 'text-left' : 'text-right',
                        col.className,
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.header}
                        {sort?.key === col.key ? (
                          sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-30" />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const division = rowDivision?.(row)
                  const locked = rowLocked?.(row)
                  return (
                    <tr
                      key={row.id}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      title={locked ? 'תקופה נעולה — צור תנועת תיקון' : undefined}
                      className={cn(
                        'border-b border-border last:border-0 transition-colors',
                        onRowClick && 'cursor-pointer hover:bg-locked-bg/60',
                        locked && 'bg-locked-bg text-locked',
                        division && `border-e-[3px] ${stripe[division]}`,
                      )}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={cn('px-3 py-2 whitespace-nowrap', col.align === 'end' ? 'text-left tnum' : 'text-right', col.className)}
                        >
                          {col.cell ? col.cell(row) : String(valueOf(row, col) ?? '')}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
              {columns.some((c) => c.footer !== undefined) && (
                <tfoot className="sticky bottom-0 bg-surface border-t border-border font-medium">
                  <tr>
                    {columns.map((col) => (
                      <td key={col.key} className={cn('px-3 py-2', col.align === 'end' ? 'text-left tnum' : 'text-right')}>
                        {col.footer}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* נייד: כרטיסים (UIUX §3.2) */}
          <div className="md:hidden flex flex-col gap-2">
            {visible.map((row) => {
              const division = rowDivision?.(row)
              const locked = rowLocked?.(row)
              const primaryCols = columns.filter((c) => primary.includes(c.key))
              return (
                <div
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'bg-surface rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 flex flex-col gap-1.5',
                    onRowClick && 'cursor-pointer',
                    locked && 'bg-locked-bg text-locked',
                    division && `border-e-[3px] ${stripe[division]}`,
                  )}
                >
                  {primaryCols.map((col) => (
                    <div key={col.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-text-3 text-xs">{col.header}</span>
                      <span className={cn(col.align === 'end' && 'tnum')}>{col.cell ? col.cell(row) : String(valueOf(row, col) ?? '')}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          {/* עימוד */}
          <div className="flex items-center gap-3 text-xs text-text-2">
            <span>{sorted.length} שורות</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
              className="h-8 rounded-[var(--radius-btn)] border border-border bg-surface px-2"
            >
              {[25, 50, 100].map((n) => <option key={n} value={n}>{n} בעמוד</option>)}
            </select>
            {pageCount > 1 && (
              <div className="ms-auto flex items-center gap-2">
                <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 disabled:opacity-40">הקודם</button>
                <span>{page + 1} / {pageCount}</span>
                <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 disabled:opacity-40">הבא</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
