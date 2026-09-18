'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/ui/cn'

export type DivisionFilter = 'finance' | 'realestate' | 'all'

/**
 * <DivisionSwitch> — UIUX §3.1.
 * "מתג פעילות (נדל"ן / מימון / הכל) — צובע את הפס העליון בצבע הפעילות בעדינות."
 * המצב חי ב-URL (`?division=`).
 */
export function DivisionSwitch({ value, allowAll = true }: { value: DivisionFilter; allowAll?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function go(next: DivisionFilter) {
    const p = new URLSearchParams(params.toString())
    p.set('division', next)
    router.push(`${pathname}?${p.toString()}`)
  }

  const options: { key: DivisionFilter; label: string; cls: string }[] = [
    { key: 'realestate', label: 'נדל"ן', cls: 'data-[active=true]:bg-div-realestate' },
    { key: 'finance', label: 'מימון', cls: 'data-[active=true]:bg-div-finance' },
    ...(allowAll ? [{ key: 'all' as const, label: 'הכל', cls: 'data-[active=true]:bg-text-2' }] : []),
  ]

  return (
    <div role="tablist" className="inline-flex rounded-[var(--radius-btn)] border border-border bg-surface h-9 p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          role="tab"
          type="button"
          data-active={value === o.key}
          aria-selected={value === o.key}
          onClick={() => go(o.key)}
          className={cn(
            'px-3 rounded-[6px] text-sm transition-colors text-text-2 data-[active=true]:text-white',
            o.cls,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
