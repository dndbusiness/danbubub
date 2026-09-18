'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Clock, Play, Plus, Sparkles, Trash2, User } from 'lucide-react'
import { addTask, deleteTask, setTaskStatus, updateTask } from '@/app/actions/tasks'
import { ActionDrawerForm } from '@/components/forms/action-form'
import { KpiCard } from '@/components/kpi-card'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { StatusPill } from '@/components/status-pill'
import type { TaskCounts, TaskRow } from '@/lib/queries/tasks'
import { formatDate } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

const STATUS: Record<string, { label: string; tone: 'actual' | 'committed' | 'expected' | 'locked' }> = {
  open: { label: 'פתוח', tone: 'expected' },
  in_progress: { label: 'בתהליך', tone: 'committed' },
  waiting: { label: 'ממתין לאחר', tone: 'locked' },
  done: { label: 'בוצע', tone: 'actual' },
}
const PRIORITY: Record<string, { label: string; tone: 'open' | 'expected' | 'locked' }> = {
  high: { label: 'דחוף', tone: 'open' },
  normal: { label: 'רגיל', tone: 'expected' },
  low: { label: 'נמוך', tone: 'locked' },
}
type View = 'today' | 'week' | 'all' | 'auto' | 'done'

/** מסך 15 — ב.10. מובייל-first: כרטיסים בנייד, אותה רשימה במסך רחב. */
export function TasksView({ tasks, counts, users }: {
  tasks: TaskRow[]
  counts: TaskCounts
  users: { id: string; full_name: string; role: string }[]
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [view, setView] = React.useState<View>('today')
  const [assignee, setAssignee] = React.useState<string>('')

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => { const r = await fn(); if (!r.ok) { setError(r.error); return } setError(null); router.refresh() })

  const today = new Date().toISOString().slice(0, 10)
  const weekEnd = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10)

  const filtered = tasks.filter((t) => {
    if (assignee && t.assignee_id !== assignee) return false
    if (view === 'done') return t.status === 'done'
    if (t.status === 'done') return false
    if (view === 'today') return !t.due_date || t.due_date <= today
    if (view === 'week') return !t.due_date || t.due_date <= weekEnd
    if (view === 'auto') return t.auto_generated
    return true
  })

  const parents = filtered.filter((t) => !t.parent_task_id)
  const childrenOf = (id: string) => tasks.filter((t) => t.parent_task_id === id)

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="להיום" value={counts.today} count nature={counts.today ? 'open' : undefined}
          subtitle={`${counts.overdue} באיחור · ${counts.week} השבוע`}
          drillTitle="להיום" drill={<TaskList rows={tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date <= today)} />} />
        <KpiCard title="פתוחות" value={counts.open} count
          subtitle={`${counts.waiting} ממתינות לאחר`}
          drillTitle="פתוחות" drill={<TaskList rows={tasks.filter((t) => t.status !== 'done')} />} />
        <KpiCard title="נפתחו אוטומטית" value={counts.auto} count
          subtitle="מהמערכת — נסגרות לבד כשהתנאי נפתר"
          drillTitle="אוטומטיות" drill={<TaskList rows={tasks.filter((t) => t.auto_generated && t.status !== 'done')} />} />
        <KpiCard title="נסגרו השבוע" value={counts.done7} count certainty="actual"
          subtitle="7 ימים אחרונים"
          drillTitle="נסגרו" drill={<TaskList rows={tasks.filter((t) => t.status === 'done')} />} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([['today', `היום (${counts.today})`], ['week', 'השבוע'], ['all', 'הכול'], ['auto', `אוטומטיות (${counts.auto})`], ['done', 'בוצעו']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)}
            className={cn('px-3 py-1 rounded-[var(--radius-btn)] border border-border text-sm', view === k && 'bg-locked-bg font-medium')}>{l}</button>
        ))}
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}
          className="h-8 rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-sm">
          <option value="">כל האחראים</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <span className="ms-auto">
          <ActionDrawerForm title="משימה חדשה" action={addTask} submitLabel="הוסף"
            trigger={<Button variant="primary" type="button"><Plus size={16} /> משימה</Button>}>
            <Field label="כותרת" required><Input name="title" required /></Field>
            <Field label="פירוט"><Textarea name="description" rows={3} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="אחראי"><Select name="assignee_id" defaultValue="">{[<option key="" value="">—</option>, ...users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)]}</Select></Field>
              <Field label="תאריך יעד"><Input name="due_date" type="date" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="עדיפות" hint="דחוף שולח וואטסאפ לאחראי (ב.10)">
                <Select name="priority" defaultValue="normal"><option value="high">דחוף</option><option value="normal">רגיל</option><option value="low">נמוך</option></Select>
              </Field>
              <Field label="תגיות" hint="מופרדות בפסיק"><Input name="tags" /></Field>
            </div>
          </ActionDrawerForm>
        </span>
      </div>

      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      <div className="flex flex-col gap-2">
        {parents.map((t) => (
          <Card key={t.id} className={cn('flex flex-col gap-2', t.status === 'done' && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} title={t.status === 'done' ? 'החזר לפתוח' : 'סמן בוצע'}
                onClick={() => act(() => setTaskStatus(t.id, t.status === 'done' ? 'open' : 'done'))}
                className={cn('w-5 h-5 shrink-0 rounded border flex items-center justify-center',
                  t.status === 'done' ? 'bg-actual border-actual text-white' : 'border-border')}>
                {t.status === 'done' && <Check size={14} />}
              </button>
              <span className={cn('font-medium', t.status === 'done' && 'line-through')}>{t.title}</span>
              {t.auto_generated && <StatusPill tone="locked" icon={Sparkles}>אוטומטית</StatusPill>}
              {t.priority !== 'normal' && <StatusPill tone={PRIORITY[t.priority]!.tone}>{PRIORITY[t.priority]!.label}</StatusPill>}
              <StatusPill tone={STATUS[t.status]!.tone}>{STATUS[t.status]!.label}</StatusPill>
              {t.overdue_days > 0 && t.status !== 'done' && <StatusPill tone="open" icon={Clock}>{t.overdue_days} ימים באיחור</StatusPill>}
              <span className="ms-auto inline-flex items-center gap-1">
                {t.status !== 'done' && (
                  <Button size="sm" variant="ghost" disabled={pending} title="בתהליך"
                    onClick={() => act(() => setTaskStatus(t.id, t.status === 'in_progress' ? 'open' : 'in_progress'))}><Play size={14} /></Button>
                )}
                {!t.auto_generated && (
                  <Button size="sm" variant="ghost" disabled={pending} title="בטל"
                    onClick={() => { if (confirm(`לבטל את "${t.title}"?`)) act(() => deleteTask(t.id)) }}><Trash2 size={14} /></Button>
                )}
              </span>
            </div>

            {(t.description || t.notes) && <p className="text-xs text-text-2 whitespace-pre-line">{t.description ?? t.notes}</p>}

            <div className="flex flex-wrap items-center gap-3 text-xs text-text-3">
              <span className="inline-flex items-center gap-1">
                <User size={12} />
                <select value={t.assignee_id ?? ''} disabled={pending}
                  onChange={(e) => act(() => updateTask(t.id, { assignee_id: e.target.value || null }))}
                  className="h-7 rounded-[var(--radius-btn)] border border-border bg-surface px-1 text-xs">
                  <option value="">ללא אחראי</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </span>
              {t.due_date && <span>יעד {formatDate(t.due_date)}</span>}
              {t.deal_id && <Link href={`/deals/${t.deal_id}`} className="underline">{t.deal_client ?? 'לתיק'}</Link>}
              {t.tx_id && <Link href="/transactions" className="underline">לתנועה</Link>}
              {t.subtasks > 0 && <span>{t.subtasks_done}/{t.subtasks} תת-משימות</span>}
              {t.tags.map((tag) => <span key={tag} className="px-2 py-0.5 rounded bg-locked-bg">{tag}</span>)}
              {t.auto_key && <span className="font-mono" dir="ltr">{t.auto_key}</span>}
            </div>

            {childrenOf(t.id).length > 0 && (
              <ul className="flex flex-col gap-1 ps-6 border-s border-border">
                {childrenOf(t.id).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <button type="button" disabled={pending}
                      onClick={() => act(() => setTaskStatus(c.id, c.status === 'done' ? 'open' : 'done'))}
                      className={cn('w-4 h-4 rounded border flex items-center justify-center',
                        c.status === 'done' ? 'bg-actual border-actual text-white' : 'border-border')}>
                      {c.status === 'done' && <Check size={12} />}
                    </button>
                    <span className={cn(c.status === 'done' && 'line-through text-text-3')}>{c.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
        {!parents.length && (
          <Card className="text-sm text-text-3">
            {view === 'done' ? 'לא נסגרו משימות' : 'אין משימות בתצוגה הזו — וזה בסדר גמור'}
          </Card>
        )}
      </div>
    </div>
  )
}

function TaskList({ rows }: { rows: TaskRow[] }) {
  if (!rows.length) return <p className="text-sm text-text-3">אין</p>
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.slice(0, 40).map((t) => (
        <li key={t.id} className="flex justify-between gap-2 py-2">
          <span className="truncate">{t.title}</span>
          <span className="text-xs text-text-3 shrink-0">{t.assignee_name ?? '—'}{t.due_date ? ` · ${formatDate(t.due_date)}` : ''}</span>
        </li>
      ))}
    </ul>
  )
}
