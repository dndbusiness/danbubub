'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { addLink, deleteLink } from '@/app/actions/tasks'
import { ActionDrawerForm } from '@/components/forms/action-form'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import type { LinkRow } from '@/lib/queries/tasks'
import { cn } from '@/lib/ui/cn'

/** מסך 17 — כרטיסיות לפי קטגוריה, ניתנות לעריכה. */
export function LinksView({ links }: { links: LinkRow[] }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => { const r = await fn(); if (!r.ok) { setError(r.error); return } setError(null); router.refresh() })

  const categories = [...new Set(links.map((l) => l.category))]

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      <div className="flex items-center gap-2">
        <ActionDrawerForm title="קישור חדש" action={addLink} submitLabel="הוסף"
          trigger={<Button variant="primary" type="button"><Plus size={16} /> קישור</Button>}>
          <Field label="שם" required><Input name="title" required /></Field>
          <Field label="כתובת" required hint="מתחיל ב-https://"><Input name="url" dir="ltr" required /></Field>
          <Field label="קטגוריה" hint="מערכות · בנקים · רשויות · ספקים"><Input name="category" defaultValue="כללי" /></Field>
        </ActionDrawerForm>
      </div>

      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      {categories.map((cat) => (
        <section key={cat} className="flex flex-col gap-2">
          <h2 className="font-semibold text-sm">{cat}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {links.filter((l) => l.category === cat).map((l) => (
              <Card key={l.id} className="flex items-center gap-2">
                <a href={l.url} target="_blank" rel="noreferrer" className="flex-1 truncate">
                  <span className="font-medium">{l.title}</span>
                  <span className="block text-xs text-text-3 truncate" dir="ltr">{l.url}</span>
                </a>
                <a href={l.url} target="_blank" rel="noreferrer" title="פתח">
                  <Button size="sm" variant="ghost" type="button"><ExternalLink size={14} /></Button>
                </a>
                <Button size="sm" variant="ghost" disabled={pending} title="בטל"
                  onClick={() => { if (confirm(`לבטל את "${l.title}"?`)) act(() => deleteLink(l.id)) }}><Trash2 size={14} /></Button>
              </Card>
            ))}
          </div>
        </section>
      ))}

      {!links.length && (
        <Card className="text-sm text-text-3">
          אין עדיין קישורים. כדאי להתחיל מ-WISE, חשבונית ירוקה, אתר הבנק, מס הכנסה ומע״מ.
        </Card>
      )}
    </div>
  )
}
