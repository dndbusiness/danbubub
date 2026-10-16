import { cn } from '@/lib/ui/cn'
import { formatMoney } from '@/lib/ui/format'

export type Certainty = 'actual' | 'committed' | 'expected'
export type MoneyNature = 'income' | 'expense' | 'neutral' | 'open' | 'locked'

/**
 * <Money> — UIUX §4.3.
 * "רכיב אחד לכל סכום. קובע צבע, סימן, גודל, אגורות, tooltip עם net/vat/gross.
 *  אין מקום במערכת שמדפיס מספר ידנית."
 *
 * הצבע נקבע לפי הוודאות (UIUX §1.2): ירוק בפועל, כחול ודאי, כתום פוטנציאל.
 * `nature='open'` = אדום (פתוח/חסר), `locked` = אפור. `neutral` = צבע הטקסט.
 */
export function Money({
  value,
  certainty,
  nature = 'neutral',
  size = 'md',
  cents,
  vat,
  className,
}: {
  value: number
  certainty?: Certainty
  nature?: MoneyNature
  size?: 'sm' | 'md' | 'lg' | 'kpi' | 'hero'
  /** ברירת מחדל: אגורות בטבלאות (sm/md), מוסתרות בכרטיסים (lg/kpi/hero). */
  cents?: boolean
  /** tooltip עם הפירוק. */
  vat?: { net: number; vat: number; gross: number }
  className?: string
}) {
  const showCents = cents ?? (size === 'sm' || size === 'md')
  const color =
    nature === 'open'
      ? 'text-open'
      : nature === 'locked'
        ? 'text-locked'
        : certainty === 'actual'
          ? 'text-actual'
          : certainty === 'committed'
            ? 'text-committed'
            : certainty === 'expected'
              ? 'text-expected'
              : value < 0
                ? 'text-open'
                : 'text-text'

  const sizeClass = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-xl font-semibold',
    // UIUX §2.2: KPI 40px. בכרטיס צר (6 בשורה) המספר מתכווץ לפי רוחב הכרטיס
    // (container query) במקום לגלוש — ומגיע ל-40px רק כשיש מקום.
    kpi: 'leading-none font-bold text-[26px] @[200px]:text-[32px] @[260px]:text-[40px]',
    hero: 'text-[56px] leading-none font-bold',
  }[size]

  const title = vat
    ? `ללא מע"מ ${formatMoney(vat.net)} · מע"מ ${formatMoney(vat.vat)} · כולל ${formatMoney(vat.gross)}`
    : undefined

  return (
    <span
      className={cn('tnum whitespace-nowrap', color, sizeClass, className)}
      title={title}
      dir="ltr"
    >
      {formatMoney(value, { cents: showCents })}
    </span>
  )
}
