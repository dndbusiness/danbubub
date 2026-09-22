'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Minus, X } from 'lucide-react'
import { setActive, setApproved } from '@/app/actions/fixed-expenses'
import { Card } from '@/components/ui/card'
import { Money } from '@/components/money'
import { DivisionPill, StatusPill } from '@/components/status-pill'
import { FREQUENCY_LABELS, formatMonth } from '@/lib/ui/format'
import type { FixedExpenseMonth, FixedExpenseRow } from '@/lib/queries/fixed-expenses'
import { cn } from '@/lib/ui/cn'

export function FixedExpensesList({ expenses, months }: { expenses: FixedExpenseRow[]; months: Record<string, FixedExpenseMonth[]> }) {
  const router = useRouter()
  const [, start] = React.useTransition()
  const toggle = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh() })

  if (expenses.length === 0) {
    return <div className="bg-surface rounded-[var(--radius-card)] border border-border p-8 text-center text-sm text-text-2">אין הוצאות קבועות — הוסף את הראשונה</div>
  }

  return (
    <div className="flex flex-col gap-3">
      {expenses.map((f) => {
        const row = months[f.id] ?? []
        return (
          <Card key={f.id} division={f.division as 'finance'} className={cn('flex flex-col gap-3', !f.active && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{f.name}</span>
              <DivisionPill division={f.division} />
              {f.division === 'shared' && f.division_split && (
                <span className="text-xs text-text-3 tnum">{Math.round((f.division_split.finance ?? 0) * 100)}/{Math.round((f.division_split.realestate ?? 0) * 100)}</span>
              )}
              <span className="text-xs text-text-3">{f.category_name} · {FREQUENCY_LABELS[f.frequency]} · יום {f.day_of_month} · {f.account_name}</span>
              {f.variable && <StatusPill tone="expected">סכום משתנה</StatusPill>}
              <div className="ms-auto flex items-center gap-4">
                <Money value={f.amount_net} size="lg" />
                {/* SPEC §3.3 — מאושר 50/50 */}
                <label className="inline-flex items-center gap-1.5 text-xs text-text-2 cursor-pointer">
                  <input type="checkbox" checked={f.approved_by_nissim} onChange={(e) => toggle(() => setApproved(f.id, e.target.checked))} /> מאושר 50/50
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-text-2 cursor-pointer">
                  <input type="checkbox" checked={f.active} onChange={(e) => toggle(() => setActive(f.id, e.target.checked))} /> פעיל
                </label>
              </div>
            </div>

            {/* ADDENDUM ב.9 — שורת 12 חודשים */}
            <div className="grid grid-cols-6 md:grid-cols-12 gap-1" dir="ltr">
              {row.map((m) => <MonthCell key={m.month} m={m} />)}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function MonthCell({ m }: { m: FixedExpenseMonth }) {
  const style: Record<FixedExpenseMonth['status'], { cls: string; icon: React.ReactNode; label: string }> = {
    matched: { cls: 'bg-actual-bg text-actual', icon: <Check size={12} />, label: 'ירד' },
    missing: { cls: 'bg-open-bg text-open', icon: <X size={12} />, label: 'לא ירד' },
    deviation: { cls: 'bg-expected-bg text-expected', icon: <AlertTriangle size={12} />, label: 'סכום שונה' },
    future: { cls: 'bg-committed-bg text-committed', icon: <Minus size={12} />, label: 'צפוי' },
    not_due: { cls: 'bg-locked-bg text-text-3', icon: null, label: 'לא חל' },
  }
  const s = style[m.status]
  const title = `${formatMonth(m.month)} — ${s.label}${m.actual !== null ? ` · בפועל ${m.actual.toLocaleString('he-IL')} ₪` : ''} · צפוי ${m.expected.toLocaleString('he-IL')} ₪`
  return (
    <div title={title} className={cn('rounded-md px-1 py-1.5 flex flex-col items-center gap-0.5 text-[10px] tnum', s.cls)} dir="rtl">
      <span className="opacity-70">{formatMonth(m.month, { short: true })}</span>
      <span className="h-3 flex items-center">{s.icon}</span>
    </div>
  )
}
