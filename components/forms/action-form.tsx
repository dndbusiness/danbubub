'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DrillDrawer } from '@/components/drill-drawer'

type Result = { ok: true; id?: string } | { ok: false; error: string }

/**
 * טופס בתוך מגירה שמגיש server action.
 * UIUX §4.6: "כפתור ראשי אחד, Enter שומר, שגיאות מתחת לשדה ולא בפופאפ.
 *  אחרי שמירה: toast עם 'בטל' ל-8 שניות."
 */
export function ActionDrawerForm({
  trigger,
  title,
  action,
  children,
  submitLabel = 'שמור',
  onSaved,
}: {
  trigger: React.ReactNode
  title: string
  action: (fd: FormData) => Promise<Result>
  children: React.ReactNode
  submitLabel?: string
  onSaved?: (id?: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()
  const [toast, setToast] = React.useState<string | null>(null)

  function submit(fd: FormData) {
    setError(null)
    start(async () => {
      const r = await action(fd)
      if (!r.ok) { setError(r.error); return }
      setOpen(false)
      setToast('נשמר')
      setTimeout(() => setToast(null), 8_000)
      router.refresh()
      onSaved?.(r.id)
    })
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      {toast && (
        <div role="status" className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-text text-surface text-sm px-4 py-2 rounded-[var(--radius-btn)] shadow-lg">
          {toast}
        </div>
      )}
      <DrillDrawer open={open} onOpenChange={setOpen} title={title}>
        <form action={submit} className="flex flex-col gap-4">
          {children}
          {error && <p className="text-sm text-open" role="alert">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={pending}>{pending ? 'שומר…' : submitLabel}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>ביטול</Button>
          </div>
        </form>
      </DrillDrawer>
    </>
  )
}

/** UIUX §4.6 שדה סכום: "ללא מע"מ · מע"מ 2,160 · כולל 14,160" מתעדכנת חי + מתג "כולל מע"מ". */
export function AmountField({ vatRate, name = 'amount', required = true }: { vatRate: number; name?: string; required?: boolean }) {
  const [raw, setRaw] = React.useState('')
  const [incl, setIncl] = React.useState(false)
  const n = Number(raw.replace(/[,\s]/g, '')) || 0
  const net = incl ? n / (1 + vatRate) : n
  const vat = net * vatRate
  const gross = net + vat
  const fmt = (v: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(Math.round(v))
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-text-2 flex items-center gap-1">
        סכום {required && <span className="inline-block w-1.5 h-1.5 rounded-full bg-open" />}
        <span className="ms-auto inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} /> הסכום כולל מע"מ
        </span>
      </span>
      <input
        name={name} value={raw} onChange={(e) => setRaw(e.target.value)} inputMode="decimal" dir="ltr" required={required}
        className="h-10 w-full rounded-[var(--radius-btn)] border border-border bg-surface px-3 text-sm tnum"
        placeholder="0"
      />
      <input type="hidden" name="vat_mode" value={incl ? 'incl' : 'excl'} />
      <span className="text-xs text-text-3 tnum">ללא מע"מ {fmt(net)} · מע"מ {fmt(vat)} · כולל {fmt(gross)}</span>
    </label>
  )
}
