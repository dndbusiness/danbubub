'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { setAnchor } from '@/app/actions/cashflow'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/ui/format'

/**
 * טופס העוגן — UIUX §6 "עוגן יומי: פתיחה מהתראת וואטסאפ → מסך עוגן → הקלדה + שמור" (≤3 טאפים).
 * מובייל-first: שדה אחד גדול, מקלדת מספרית, Enter שומר. אחרי שמירה — התוצאה של סגירת היום.
 */
export function AnchorForm({ today, current, inline = false, onSaved }: {
  today: string
  current: { balance: number; available_credit: number | null; date: string } | null
  inline?: boolean
  onSaved?: () => void
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{ variance: number | null; newAlerts: number } | null>(null)
  const isToday = current?.date === today

  function submit(fd: FormData) {
    setError(null)
    start(async () => {
      const r = await setAnchor(fd)
      if (!r.ok) { setError(r.error); return }
      setResult({ variance: r.variance, newAlerts: r.newAlerts })
      router.refresh()
      onSaved?.()
    })
  }

  const inputCls = 'h-14 w-full rounded-[var(--radius-btn)] border border-border bg-surface px-4 text-2xl tnum text-center focus-visible:border-committed'
  return (
    <form action={submit} className={inline ? 'flex flex-col gap-3' : 'flex flex-col gap-4'}>
      <input type="hidden" name="date" value={today} />
      <div className={inline ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-4'}>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-text-2">יתרה היום ₪</span>
          <input name="balance" inputMode="decimal" dir="ltr" autoFocus={!inline} required placeholder={current ? String(Math.round(current.balance)) : '0'} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-text-2">מסגרת פנויה ₪ <span className="text-text-3">(לא חובה)</span></span>
          <input name="available_credit" inputMode="decimal" dir="ltr" placeholder={current?.available_credit != null ? String(Math.round(current.available_credit)) : '0'} className={inputCls} />
        </label>
      </div>
      {error && <p className="text-sm text-open" role="alert">{error}</p>}
      <div className="flex items-center gap-3 flex-wrap">
        <Button type="submit" variant="primary" size="lg" disabled={pending} className={inline ? '' : 'w-full'}>
          {pending ? 'שומר…' : isToday ? 'עדכן עוגן' : 'שמור'}
        </Button>
        {isToday && !result && <span className="text-sm text-actual inline-flex items-center gap-1"><Check size={16} /> הוזן היום: {formatMoney(current!.balance)}</span>}
      </div>
      {result && (
        <div role="status" className="rounded-[var(--radius-btn)] bg-actual-bg text-actual text-sm px-3 py-2 flex flex-col gap-1">
          <span className="inline-flex items-center gap-1"><Check size={16} /> העוגן נשמר.</span>
          {result.variance !== null && <span className={Math.abs(result.variance) > 0 ? 'text-text' : ''}>סגירת יום: סטייה {formatMoney(result.variance)} מול הצפי.</span>}
          {result.newAlerts > 0 && <span className="text-open">{result.newAlerts} התראות חדשות — ראו בפעמון.</span>}
        </div>
      )}
    </form>
  )
}
