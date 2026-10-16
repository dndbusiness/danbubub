import Link from 'next/link'
import { Bell, Search } from 'lucide-react'
import { PeriodPicker } from '@/components/period-picker'
import { DivisionSwitch, type DivisionFilter } from '@/components/division-switch'
import { divisionAccentClass } from '@/lib/ui/params'
import { cn } from '@/lib/ui/cn'

/**
 * פס עליון 56px — UIUX §3.1.
 * בורר תקופה + מתג פעילות (גלובליים, ב-URL) · פעמון · חיפוש · משתמש.
 */
export function Topbar({
  period,
  division,
  periodLocked,
  alertCount = 0,
  userName = 'דן',
}: {
  period: string
  division: DivisionFilter
  periodLocked?: boolean
  alertCount?: number
  userName?: string
}) {
  return (
    <header
      className={cn(
        'h-14 bg-surface border-b-2 flex items-center gap-3 px-4 sticky top-0 z-20',
        divisionAccentClass(division),
      )}
    >
      <PeriodPicker period={period} locked={periodLocked} />
      <DivisionSwitch value={division} />
      <div className="ms-auto flex items-center gap-1">
        <Link href="/alerts" prefetch={false} className="relative p-2 rounded text-text-2 hover:bg-locked-bg" aria-label="התראות">
          <Bell size={18} />
          {alertCount > 0 && (
            <span className="absolute -top-0.5 -end-0.5 min-w-4 h-4 px-1 rounded-full bg-open text-white text-[10px] flex items-center justify-center tnum">
              {alertCount}
            </span>
          )}
        </Link>
        <button type="button" className="p-2 rounded text-text-2 hover:bg-locked-bg hidden sm:block" aria-label="חיפוש">
          <Search size={18} />
        </button>
        <span className="text-sm font-medium ps-2">{userName}</span>
      </div>
    </header>
  )
}
