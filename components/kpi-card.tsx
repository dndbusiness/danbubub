'use client'

import * as React from 'react'
import { ChevronsLeftRight, TrendingDown, TrendingUp } from 'lucide-react'
import { Card, type Division } from '@/components/ui/card'
import { Money, type Certainty, type MoneyNature } from '@/components/money'
import { DrillDrawer } from '@/components/drill-drawer'
import { cn } from '@/lib/ui/cn'

/**
 * <KpiCard> — UIUX §4.1.
 *
 *   ┌────────────────────────────┐
 *   │ נגבה החודש          ↓ ירוק │  כותרת 14px + אייקון nature
 *   │ 123,500 ₪                  │  40px 700
 *   │ ▲ 12% מחודש שעבר · יעד 500K│  12px; ▲ ירוק / ▼ אדום
 *   └────────────────────────────┘
 *
 * "לחיצה על הכרטיס = drill-down drawer." SPEC §5 חוק המסכים: אין מספר עיוור.
 * הפירוט מגיע ב-`drill` — תוכן ה-drawer שמרכיב את המספר.
 */
export function KpiCard({
  title,
  value,
  certainty,
  nature,
  icon,
  delta,
  subtitle,
  division,
  drill,
  drillTitle,
  loading,
  stale,
  count,
  className,
}: {
  title: string
  value: number
  certainty?: Certainty
  nature?: MoneyNature
  /** אייקון ה-nature. ReactNode ולא קומפוננטה — כדי שאפשר יהיה להעביר מ-Server Component. */
  icon?: React.ReactNode
  /** שינוי יחסי מהתקופה הקודמת, כשבר (0.12 = +12%). */
  delta?: number | null
  subtitle?: React.ReactNode
  division?: Division
  /** תוכן ה-drill-down. בלעדיו הכרטיס אינו לחיץ — וזה מצב שאסור במסך אמיתי. */
  drill?: React.ReactNode
  drillTitle?: string
  loading?: boolean
  stale?: React.ReactNode
  /** מונה (למשל "4 תנועות") ולא סכום — מוצג כמספר, בלי ₪. */
  count?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const clickable = Boolean(drill)

  if (loading) {
    return (
      <Card division={division} className={className}>
        <div className="skeleton h-4 w-24 mb-3" />
        <div className="skeleton h-10 w-40 mb-2" />
        <div className="skeleton h-3 w-32" />
      </Card>
    )
  }

  return (
    <>
      <Card
        division={division}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => setOpen(true) : undefined}
        onKeyDown={clickable ? (e) => e.key === 'Enter' && setOpen(true) : undefined}
        className={cn('relative flex flex-col gap-2 @container min-w-0', clickable && 'cursor-pointer hover:shadow-md transition-shadow', className)}
      >
        {stale && <div className="absolute top-3 start-3">{stale}</div>}
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-2 font-medium">{title}</span>
          {icon && <span className="text-text-3">{icon}</span>}
        </div>
        {count ? (
          <span className={cn('tnum leading-none font-bold text-[26px] @[200px]:text-[32px] @[260px]:text-[40px]', nature === 'open' ? 'text-open' : nature === 'locked' ? 'text-locked' : certainty === 'actual' ? 'text-actual' : 'text-text')} dir="ltr">
            {new Intl.NumberFormat('he-IL').format(value)}
          </span>
        ) : (
          <Money value={value} certainty={certainty} nature={nature} size="kpi" />
        )}
        <div className="text-xs text-text-3 flex items-center gap-2 min-h-4">
          {delta !== undefined && delta !== null && (
            <span className={cn('inline-flex items-center gap-0.5', delta >= 0 ? 'text-actual' : 'text-open')}>
              {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {Math.abs(Math.round(delta * 100))}%
            </span>
          )}
          {subtitle}
          {clickable && <ChevronsLeftRight size={12} className="ms-auto opacity-60" />}
        </div>
      </Card>
      {drill && (
        <DrillDrawer
          open={open}
          onOpenChange={setOpen}
          title={drillTitle ?? title}
          amount={count ? <span className="tnum text-xl font-semibold">{value}</span> : <Money value={value} certainty={certainty} nature={nature} size="lg" />}
        >
          {drill}
        </DrillDrawer>
      )}
    </>
  )
}
