import { sql, withActor } from '@/lib/db'
import { runJob } from './run'

/**
 * חלק ג' `wise_import` — "ידני שבועי". אין API ל-WISE (שאלה פתוחה #14), ולכן
 * הג'וב לא מייבא לבד: הוא בודק שהייצוא השבועי נקלט, ואם לא — פותח משימה עם
 * `rule_key` ייחודי (הנחיה 18) ומציין כמה לידים לא זזו.
 */
export async function wiseImportJob(asOf: string): Promise<{ rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }> {
  return runJob('wise_import', async () => {
    const [last] = await sql<{ imported_at: string | null; days: number | null }[]>`
      select max(created_at)::text as imported_at,
             extract(day from ${asOf}::timestamptz - max(created_at))::int as days
      from import_batches where source = 'wise_import' and deleted_at is null`
    const days = last?.days ?? null
    if (days !== null && days < 7) return { rowsTouched: 0, skipped: `הייצוא נקלט לפני ${days} ימים`, detail: { lastImport: last?.imported_at } }

    const [stats] = await sql<{ open_leads: number; stale: number }[]>`
      select count(*) filter (where stage in ('received', 'contacted'))::int as open_leads,
             count(*) filter (where stage in ('received', 'contacted') and date < ${asOf}::date - 14)::int as stale
      from leads where deleted_at is null`

    const week = asOf.slice(0, 10)
    const created = await withActor(async (tx) => {
      const res = await tx`
        insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
        values (${'לייצא מ-WISE (מתעניינים, לקוחות, הגשות) ולקלוט למערכת'}, ${asOf},
                ${(stats?.stale ?? 0) > 20 ? 'high' : 'normal'}, true, ${`wise_import:${week}`},
                ${`${stats?.open_leads ?? 0} לידים פתוחים · ${stats?.stale ?? 0} מהם בלי תזוזה מעל שבועיים${last?.imported_at ? ` · ייבוא אחרון לפני ${days} ימים` : ' · טרם יובא ייצוא'}`})
        on conflict do nothing`
      return res.count
    })
    return { rowsTouched: created, detail: { lastImport: last?.imported_at, daysSince: days, openLeads: stats?.open_leads ?? 0 } }
  })
}
