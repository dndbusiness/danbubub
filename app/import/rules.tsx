'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deactivateRule } from '@/app/actions/imports'
import { DataTable, type Column } from '@/components/data-table'
import { DivisionPill } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import { NATURE_LABELS } from '@/lib/ui/format'
import type { RuleRow } from '@/lib/queries/imports'

/** SPEC §4.4 — הכללים שנלמדו: תבנית → ערכי ברירת מחדל, וכמה פעמים כל אחד תפס. */
export function RulesTable({ rows }: { rows: RuleRow[] }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const columns: Column<RuleRow>[] = [
    { key: 'pattern', header: 'תבנית', cell: (r) => <span className="font-mono text-xs" dir="ltr">{r.pattern}</span> },
    { key: 'account_name', header: 'חשבון', value: (r) => r.account_name ?? 'כל החשבונות' },
    { key: 'category_name', header: 'קטגוריה', value: (r) => r.category_name ?? '' },
    { key: 'set_division', header: 'פעילות', value: (r) => r.set_division ?? '', cell: (r) => r.set_division ? <DivisionPill division={r.set_division} /> : '—' },
    { key: 'set_nature', header: 'סוג', value: (r) => r.set_nature ? NATURE_LABELS[r.set_nature] ?? r.set_nature : '', mobileHidden: true },
    { key: 'hit_count', header: 'תפס', value: (r) => r.hit_count, align: 'end' },
    {
      key: 'actions', header: '', cell: (r) => (
        <Button size="sm" variant="ghost" disabled={pending} aria-label="בטל כלל" onClick={(e) => { e.stopPropagation(); start(async () => { await deactivateRule(r.id); router.refresh() }) }}>
          <Trash2 size={14} />
        </Button>
      ),
    },
  ]
  return <DataTable rows={rows} columns={columns} exportName="rules" primaryKeys={['pattern', 'category_name', 'hit_count']} emptyState='עדיין אין כללים. אחרי סיווג ידני לחצו "הפוך לכלל"' />
}
