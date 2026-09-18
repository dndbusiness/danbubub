'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Landmark, Receipt } from 'lucide-react'
import { uploadBankStatement, uploadGreenInvoice } from '@/app/actions/imports'
import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/field'
import { Card } from '@/components/ui/card'
import type { CardAccount } from '@/lib/queries/imports'
import { cn } from '@/lib/ui/cn'

function DropZone({ hint, accept = '.csv,.xlsx,.xls' }: { hint: string; accept?: string }) {
  const [drag, setDrag] = React.useState(false)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false)
        const f = e.dataTransfer.files?.[0]
        if (f && fileRef.current) { const dt = new DataTransfer(); dt.items.add(f); fileRef.current.files = dt.files; setFileName(f.name) }
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border-2 border-dashed p-5 text-sm cursor-pointer',
        drag ? 'border-committed bg-committed-bg' : 'border-border hover:bg-locked-bg',
      )}
    >
      <input ref={fileRef} type="file" name="file" accept={accept} className="sr-only" required onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
      <span className="font-medium">{fileName ?? 'גררו לכאן קובץ CSV / XLSX או לחצו לבחירה'}</span>
      <span className="text-xs text-text-3">{hint}</span>
    </label>
  )
}

/** מסך 11 — דף בנק (SPEC §4.2). ההעלאה משדכת לתנועות קיימות ומציגה לאישור. */
export function BankUploadCard({ accounts, formats }: { accounts: CardAccount[]; formats: { id: string; label: string }[] }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function submit(fd: FormData) {
    setError(null)
    start(async () => {
      const r = await uploadBankStatement(fd)
      if (!r.ok) { setError(r.error); return }
      router.push(`/import/${r.id}${r.existing ? '?existing=1' : ''}`)
    })
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Landmark size={18} className="text-text-2" />
        <h2 className="font-semibold">דף בנק</h2>
        <span className="text-xs text-text-3">הפועלים · לאומי · דיסקונט · מזרחי — היתרה הרצה נבדקת מול השורות</span>
      </div>
      {!accounts.length && <p className="text-sm text-open">אין חשבון בנק פעיל במערכת.</p>}
      <form action={submit} className="flex flex-col gap-3">
        <DropZone hint="אותו קובץ פעמיים = 0 שורות חדשות. תנועה שכבר במערכת תשודך, לא תיווצר מחדש." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="חשבון" required>
            <Select name="account_id" required defaultValue={accounts[0]?.id ?? ''}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.entity_name}</option>)}
            </Select>
          </Field>
          <Field label="פורמט" hint="ריק = זיהוי אוטומטי לפי הכותרות">
            <Select name="format_id" defaultValue="">
              <option value="">זיהוי אוטומטי</option>
              {formats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm text-open" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={pending || !accounts.length}>{pending ? 'מפענח ומשדך…' : 'פענח והצג לאישור'}</Button>
      </form>
    </Card>
  )
}

/** מסך 11 — ייצוא מחשבונית ירוקה (§4.2). חשבונית ירוקה נשארת המקור למסמכי מס. */
export function GreenInvoiceUploadCard() {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)

  function submit(fd: FormData) {
    setError(null); setDone(null)
    start(async () => {
      const r = await uploadGreenInvoice(fd)
      if (!r.ok) { setError(r.error); return }
      setDone(r.existing
        ? 'הקובץ הזה כבר יובא — לא נוצרו שורות חדשות.'
        : `${r.created} מסמכים נקלטו · ${r.matched} שודכו לתנועה · ${r.already} כבר היו במערכת${r.duplicates ? ` · ${r.duplicates} כפולים בקובץ` : ''}${r.partnerReview ? ` · ${r.partnerReview} ממתינים להכרעת שותף` : ''}`)
      router.refresh()
    })
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Receipt size={18} className="text-text-2" />
        <h2 className="font-semibold">חשבונית ירוקה</h2>
        <span className="text-xs text-text-3">ייצוא הוצאות / הכנסות — סוגר את הפערים במסך 12</span>
      </div>
      <form action={submit} className="flex flex-col gap-3">
        <DropZone hint="הייצוא עם 14 העמודות. הסכומים נלקחים מ״סכום הוצאה עסקית״ בשקלים." />
        <Field label="כיוון" required hint="התקבל = חשבוניות ספקים · הוצא = חשבוניות שהוצאנו ללקוחות">
          <Select name="direction" defaultValue="received">
            <option value="received">התקבל מספק</option>
            <option value="issued">הוצא ללקוח</option>
          </Select>
        </Field>
        {error && <p className="text-sm text-open" role="alert">{error}</p>}
        {done && <p className="text-sm text-actual" role="status">{done}</p>}
        <Button type="submit" variant="primary" disabled={pending}>{pending ? 'קולט…' : 'קלוט מסמכים'}</Button>
      </form>
    </Card>
  )
}
