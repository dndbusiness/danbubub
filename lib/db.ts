/**
 * חיבור ל-Postgres. עובד מול Postgres מקומי ומול Supabase (שניהם Postgres).
 * RLS ו-Auth של Supabase — שלב 10. עד אז: חיבור ישיר, משתמש מוגדר ידנית.
 */

import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL לא מוגדר. ראו .env.example')
}

// singleton כדי שלא ייפתח pool חדש בכל hot-reload
const globalForDb = globalThis as unknown as { __harelSql?: ReturnType<typeof postgres> }

export const sql =
  globalForDb.__harelSql ??
  postgres(url, {
    max: 5,
    // NUMERIC → number. SPEC §11.5: הערכים נשמרים ב-NUMERIC(14,2); בקריאה
    // הם מומרים למספר JS עם 2 ספרות — בטוח לתצוגה, וכל חישוב עובר ב-lib/rules.
    types: { numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: Number } },
    transform: { undefined: null },
  })

if (process.env.NODE_ENV !== 'production') globalForDb.__harelSql = sql

/**
 * המשתמש הפועל — SPEC §1.7 (מי שינה מה) ו-§11.4 (created_by).
 * עד שלב 10 (Auth) אין התחברות; המזהה מגיע מ-HAREL_ACTOR_ID או ממשתמש ה-seed.
 * הטריגרים ב-DB קוראים אותו מ-`app.current_user_id`.
 */
export const ACTOR_ID = process.env.HAREL_ACTOR_ID ?? '00000000-0000-4000-8000-000000000001'

/** מריץ פעולה בטרנזקציה עם המשתמש הפועל מוגדר — כל כתיבה עוברת דרך כאן. */
export async function withActor<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.current_user_id', ${ACTOR_ID}, true)`
    return fn(tx)
  }) as Promise<T>
}
