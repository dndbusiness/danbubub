'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, Plus } from 'lucide-react'
import { createCardAccount, uploadCardStatement } from '@/app/actions/imports'
import { ActionDrawerForm } from '@/components/forms/action-form'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { Card } from '@/components/ui/card'
import type { CardAccount } from '@/lib/queries/imports'
import { cn } from '@/lib/ui/cn'

/**
 * מסך 11 שלב 1 — UIUX §5.5: "גרירת קובץ / בחירה. זיהוי אוטומטי של הפורמט."
 * ההעלאה שומרת הצעות בלבד; האישור במסך האצווה.
 */
export function UploadCard({ accounts, entities, formats }: {
  accounts: CardAccount[]
  entities: { id: string; name: string }[]
  formats: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [drag, setDrag] = React.useState(false)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  function submit(fd: FormData) {
    setError(null)
    start(async () => {
      const r = await uploadCardStatement(fd)
      if (!r.ok) { setError(r.error); return }
      router.push(`/import/${r.id}${r.existing ? '?existing=1' : ''}`)
    })
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <FileUp size={18} className="text-text-2" />
        <h2 className="font-semibold">קובץ אשראי חדש</h2>
        <span className="text-xs text-text-3">ישראכרט · מקס · כאל — זיהוי אוטומטי לפי כותרות</span>
      </div>

      {!accounts.length && (
        <p className="text-sm text-open">אין עדיין כרטיס אשראי מוגדר — הוסיפו אחד כדי לייבא.</p>
      )}

      <form action={submit} className="flex flex-col gap-3">
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault(); setDrag(false)
            const f = e.dataTransfer.files?.[0]
            if (f && fileRef.current) { const dt = new DataTransfer(); dt.items.add(f); fileRef.current.files = dt.files; setFileName(f.name) }
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border-2 border-dashed p-6 text-sm cursor-pointer',
            drag ? 'border-committed bg-committed-bg' : 'border-border hover:bg-locked-bg',
          )}
        >
          <input ref={fileRef} type="file" name="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} required />
          <span className="font-medium">{fileName ?? 'גררו לכאן קובץ CSV / XLSX או לחצו לבחירה'}</span>
          <span className="text-xs text-text-3">עד 10MB. אותו קובץ פעמיים = 0 שורות חדשות.</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="כרטיס" required>
            <Select name="account_id" required defaultValue={accounts[0]?.id ?? ''}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.billing_day ? ` · חיוב ב-${a.billing_day}` : ''}</option>)}
            </Select>
          </Field>
          <Field label="יום החיוב בבנק" hint="ריק = התאריך האחרון בקובץ">
            <Input name="billing_date" type="date" />
          </Field>
          <Field label="פורמט" hint="ריק = זיהוי אוטומטי">
            <Select name="format_id" defaultValue="">
              <option value="">זיהוי אוטומטי</option>
              {formats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm text-open" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending || !accounts.length}>{pending ? 'מפענח…' : 'פענח והצג לאישור'}</Button>
          <ActionDrawerForm
            title="כרטיס אשראי חדש"
            action={createCardAccount}
            submitLabel="הוסף כרטיס"
            trigger={<Button type="button" variant="ghost"><Plus size={16} /> כרטיס חדש</Button>}
          >
            <Field label="שם" required hint='למשל "ישראכרט 1234 — ניסים"'><Input name="name" required /></Field>
            <Field label="ישות" required>
              <Select name="entity_id" required>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="יום חיוב" required hint="2 / 10 / 15"><Input name="billing_day" type="number" min={1} max={31} required defaultValue={10} /></Field>
              <Field label="פעילות ברירת מחדל">
                <Select name="default_division" defaultValue="finance">
                  <option value="finance">מימון</option><option value="realestate">נדל"ן</option>
                </Select>
              </Field>
            </div>
          </ActionDrawerForm>
        </div>
      </form>
    </Card>
  )
}
