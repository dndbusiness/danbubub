import { Clock } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

/**
 * <StaleBadge> — UIUX §4.1 "מצב ישן": ⏱ 'עודכן לפני 2 ימים' באדום.
 * `updatedAt` הוא ISO; `now` מועבר מבחוץ כדי שהרנדר יהיה דטרמיניסטי.
 */
export function StaleBadge({
  updatedAt,
  now,
  staleAfterHours = 48,
  className,
}: {
  updatedAt: string | null
  now: string
  staleAfterHours?: number
  className?: string
}) {
  if (!updatedAt) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-open', className)}>
        <Clock size={12} /> לא עודכן
      </span>
    )
  }
  const hours = Math.floor((Date.parse(now) - Date.parse(updatedAt)) / 3_600_000)
  const stale = hours >= staleAfterHours
  const label =
    hours < 1 ? 'עודכן עכשיו' : hours < 24 ? `עודכן לפני ${hours} שע׳` : `עודכן לפני ${Math.floor(hours / 24)} ימים`
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', stale ? 'text-open' : 'text-text-3', className)}>
      <Clock size={12} /> {label}
      {!stale && <span className="text-actual">✓</span>}
    </span>
  )
}
