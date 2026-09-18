'use client'

import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { addMonths } from '@/lib/rules/period.js'
import { formatMonth } from '@/lib/ui/format'

/**
 * <PeriodPicker> — UIUX §3.1.
 * "בורר תקופה גלובלי בפס העליון: משפיע על כל המסך. חודש נעול מוצג עם 🔒."
 * המצב חי ב-URL (`?period=YYYY-MM`) כדי שכל מסך, קישור ו-drill יקראו אותו מאותו מקום.
 */
export function PeriodPicker({ period, locked }: { period: string; locked?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function go(next: string) {
    const p = new URLSearchParams(params.toString())
    p.set('period', next)
    router.push(`${pathname}?${p.toString()}`)
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-[var(--radius-btn)] border border-border bg-surface h-9 px-1">
      <button type="button" onClick={() => go(addMonths(period, 1))} aria-label="חודש הבא" className="p-1.5 rounded hover:bg-locked-bg">
        <ChevronRight size={16} />
      </button>
      <span className="tnum text-sm font-medium px-2 inline-flex items-center gap-1 min-w-20 justify-center">
        {locked && <Lock size={12} className="text-locked" />}
        {formatMonth(period)}
      </span>
      <button type="button" onClick={() => go(addMonths(period, -1))} aria-label="חודש קודם" className="p-1.5 rounded hover:bg-locked-bg">
        <ChevronLeft size={16} />
      </button>
    </div>
  )
}
