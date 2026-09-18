'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Lock, LockOpen } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/ui/cn'

const STORAGE_KEY = 'harel.pin.unlockedUntil'
/** SPEC §6 — "פג תוקף אחרי 10 דקות". */
export const PIN_TTL_MS = 10 * 60 * 1000

function readUnlockedUntil(): number {
  try {
    return Number(sessionStorage.getItem(STORAGE_KEY) ?? 0)
  } catch {
    return 0
  }
}

/**
 * <PinGate> — UIUX §3.1 / SPEC §6.
 * "לחיצה ראשונה פותחת מודל PIN (4–6 ספרות, מקלדת מספרית). אחרי אישור:
 *  מנעול פתוח ירוק + טיימר 10 דק'. פג → המסכים מתערפלים עם כפתור 'פתח שוב'."
 *
 * האימות עצמו נעשה ב-`verify` (server action) — ה-PIN לעולם לא מושווה בלקוח.
 * UIUX §9: מודל מותר רק ל-PIN ולאישורים הרסניים — זה המקרה.
 */
export function PinGate({
  verify,
  areaLabel,
  children,
}: {
  verify: (pin: string) => Promise<boolean>
  areaLabel: string
  children: React.ReactNode
}) {
  const [unlockedUntil, setUnlockedUntil] = React.useState(0)
  const [open, setOpen] = React.useState(false)
  const [pin, setPin] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    setUnlockedUntil(readUnlockedUntil())
    const t = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(t)
  }, [])

  const unlocked = unlockedUntil > now

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const ok = await verify(pin)
    setBusy(false)
    if (!ok) {
      setError('קוד שגוי')
      setPin('')
      return
    }
    const until = Date.now() + PIN_TTL_MS
    try { sessionStorage.setItem(STORAGE_KEY, String(until)) } catch { /* private mode */ }
    setUnlockedUntil(until)
    setOpen(false)
    setPin('')
  }

  const remainingMin = unlocked ? Math.ceil((unlockedUntil - now) / 60_000) : 0

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-3 text-xs">
        {unlocked ? (
          <span className="inline-flex items-center gap-1 text-actual"><LockOpen size={14} /> פתוח · {remainingMin} דק׳</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-locked"><Lock size={14} /> אזור מוגן — {areaLabel}</span>
        )}
      </div>

      <div className={cn(!unlocked && 'blur-sm pointer-events-none select-none')} aria-hidden={!unlocked}>
        {children}
      </div>

      {!unlocked && (
        <div className="absolute inset-0 flex items-start justify-center pt-16">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-[var(--radius-btn)] bg-brand text-white font-medium shadow-lg"
          >
            <Lock size={16} /> {unlockedUntil > 0 ? 'פתח שוב' : 'הזן קוד'}
          </button>
        </div>
      )}

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Content dir="rtl" className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] bg-surface rounded-[var(--radius-card)] shadow-xl p-5">
            <Dialog.Title className="text-base font-semibold mb-1">קוד גישה</Dialog.Title>
            <Dialog.Description className="text-xs text-text-2 mb-4">{areaLabel}</Dialog.Description>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <input
                autoFocus
                inputMode="numeric"
                pattern="[0-9]{4,6}"
                minLength={4}
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className="h-12 text-center text-2xl tracking-[0.5em] tnum rounded-[var(--radius-btn)] border border-border bg-surface"
                aria-label="קוד"
              />
              {error && <span className="text-xs text-open">{error}</span>}
              <button type="submit" disabled={busy || pin.length < 4} className="h-10 rounded-[var(--radius-btn)] bg-brand text-white font-medium disabled:opacity-50">
                אישור
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
