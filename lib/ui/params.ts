import type { DivisionFilter } from '@/components/division-switch'

export type SearchParams = Record<string, string | string[] | undefined>

/** מצב גלובלי שחי ב-URL: תקופה ופעילות (UIUX §3.1). */
export function readGlobalParams(sp: SearchParams, now: string) {
  const period = typeof sp.period === 'string' && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : now.slice(0, 7)
  const raw = typeof sp.division === 'string' ? sp.division : 'all'
  const division: DivisionFilter = raw === 'finance' || raw === 'realestate' ? raw : 'all'
  return { period, division }
}

/** צבע הפס התחתון של הפס העליון לפי הפעילות (UIUX §3.1). */
export function divisionAccentClass(value: DivisionFilter): string {
  return value === 'finance'
    ? 'border-b-div-finance'
    : value === 'realestate'
      ? 'border-b-div-realestate'
      : 'border-b-border'
}
