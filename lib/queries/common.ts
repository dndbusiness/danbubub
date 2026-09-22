import { sql } from '@/lib/db'

export interface CategoryRow { id: string; name: string; kind: string }
export interface AccountRow { id: string; name: string; type: string; default_division: string }
export interface PeriodRow { division: string; year: number; month: number; status: string }

export async function listCategories(): Promise<CategoryRow[]> {
  return sql<CategoryRow[]>`
    select id, name, kind from categories
    where deleted_at is null and active
    order by sort_order, name`
}

export async function listAccounts(): Promise<AccountRow[]> {
  return sql<AccountRow[]>`
    select id, name, type, default_division from accounts
    where deleted_at is null and active
    order by name`
}

/** SPEC §1.6 — האם החודש נעול לפעילות. */
export async function isPeriodLocked(month: string, division: 'finance' | 'realestate'): Promise<boolean> {
  const [y, m] = month.split('-').map(Number)
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from periods
    where division = ${division} and year = ${y!} and month = ${m!}
      and status = 'closed' and deleted_at is null`
  return (rows[0]?.n ?? 0) > 0
}

/** SPEC §3.1 — שיעור המע"מ שבתוקף בתאריך. */
export async function vatRateOn(date: string): Promise<number> {
  const rows = await sql<{ rate: number }[]>`
    select rate from vat_rates where valid_from <= ${date} order by valid_from desc limit 1`
  if (rows[0]) return rows[0].rate
  const s = await sql<{ value: number }[]>`select (value #>> '{}')::numeric as value from settings where key = 'vat_rate'`
  return s[0]?.value ?? 0.18
}

/** מונה התראות פעילות לפעמון (ADDENDUM ב.11). */
export async function activeAlertCount(): Promise<number> {
  const rows = await sql<{ n: number }[]>`select count(*)::int as n from v_active_alerts`
  return rows[0]?.n ?? 0
}
