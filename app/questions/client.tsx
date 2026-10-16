'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, HelpCircle } from 'lucide-react'
import { answerQuestion } from '@/app/actions/tasks'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Select, Textarea } from '@/components/ui/field'
import { StatusPill } from '@/components/status-pill'
import type { QuestionRow } from '@/lib/queries/tasks'
import type { CategoryRow } from '@/lib/queries/common'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

const WHO: Record<string, string> = { ask_nissim: 'ניסים', ask_aviv: 'אביב', ask_yoni: 'יוני' }

/**
 * מסך 16 — "השותף עונה מהנייד וסוגר". כרטיס אחד לכל שאלה, שדה תשובה גדול,
 * וקטגוריה אופציונלית — כדי שהתשובה גם תסווג ולא רק תיענה.
 */
export function QuestionsView({ rows, counts, categories, who }: {
  rows: QuestionRow[]
  counts: { who: string; n: number; amount: number }[]
  categories: CategoryRow[]
  who: string | null
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [answers, setAnswers] = React.useState<Record<string, string>>({})
  const [cats, setCats] = React.useState<Record<string, string>>({})

  const send = (txId: string) => {
    const text = (answers[txId] ?? '').trim()
    if (!text) { setError('יש לכתוב תשובה'); return }
    start(async () => {
      const r = await answerQuestion(txId, text, { categoryId: cats[txId] || null })
      if (!r.ok) { setError(r.error); return }
      setError(null)
      setAnswers((a) => ({ ...a, [txId]: '' }))
      router.refresh()
    })
  }

  const setWho = (next: string | null) => {
    const url = next ? `/questions?who=${next}` : '/questions'
    router.push(url)
  }

  const total = counts.reduce((a, c) => a + c.n, 0)

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {['ask_nissim', 'ask_aviv', 'ask_yoni'].map((k) => {
          const c = counts.find((x) => x.who === k)
          return (
            <KpiCard key={k} title={`ממתין ל${WHO[k]}`} value={c?.n ?? 0} count nature={c?.n ? 'open' : undefined}
              subtitle={c?.n ? `${formatMoney(Number(c.amount))} בתנועות שממתינות` : 'אין שאלות פתוחות'}
              drillTitle={`שאלות ל${WHO[k]}`}
              drill={<ul className="divide-y divide-border text-sm">{rows.filter((r) => r.review_status === k).map((r) => <li key={r.tx_id} className="flex justify-between py-2"><span className="truncate">{formatDate(r.date)} · {r.counterparty ?? r.description ?? '—'}</span><Money value={Number(r.amount_gross)} /></li>)}{!rows.some((r) => r.review_status === k) && <li className="py-2 text-text-3">אין</li>}</ul>} />
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setWho(null)}
          className={cn('px-3 py-1 rounded-[var(--radius-btn)] border border-border text-sm', !who && 'bg-locked-bg font-medium')}>
          הכול ({total})
        </button>
        {['ask_nissim', 'ask_aviv', 'ask_yoni'].map((k) => (
          <button key={k} type="button" onClick={() => setWho(k)}
            className={cn('px-3 py-1 rounded-[var(--radius-btn)] border border-border text-sm', who === k && 'bg-locked-bg font-medium')}>
            {WHO[k]} ({counts.find((c) => c.who === k)?.n ?? 0})
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <Card key={r.tx_id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <HelpCircle size={16} className="text-expected" />
              <span className="font-medium">{r.counterparty ?? r.description ?? 'תנועה ללא תיאור'}</span>
              <Money value={Number(r.amount_gross)} />
              <StatusPill tone="expected">{WHO[r.review_status] ?? r.review_status}</StatusPill>
              <span className="text-xs text-text-3 ms-auto">
                {formatDate(r.date)}{r.account_name ? ` · ${r.account_name}` : ''}{r.category_name ? ` · ${r.category_name}` : ' · ללא קטגוריה'}
                {r.days_open > 3 ? ` · פתוח ${r.days_open} ימים` : ''}
              </span>
            </div>

            {r.review_note && (
              <p className="text-xs text-text-2 whitespace-pre-line bg-locked-bg rounded-[var(--radius-btn)] p-2">{r.review_note}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
              <Field label="התשובה" hint="נשמרת על התנועה עם השם והתאריך">
                <Textarea rows={2} value={answers[r.tx_id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [r.tx_id]: e.target.value }))} />
              </Field>
              <div className="flex gap-2">
                <Select value={cats[r.tx_id] ?? ''} onChange={(e) => setCats((c) => ({ ...c, [r.tx_id]: e.target.value }))}>
                  <option value="">בלי לשנות קטגוריה</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button variant="primary" disabled={pending} onClick={() => send(r.tx_id)}>
                  <Check size={16} /> שלח וסגור
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {!rows.length && <Card className="text-sm text-text-3">אין שאלות פתוחות — התור ריק.</Card>}
      </div>
    </div>
  )
}
