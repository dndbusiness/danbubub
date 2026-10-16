import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * הקמת מסד הנתונים מהדפדפן — בלי טרמינל ובלי SQL editor: db/bundle.sql (הסכימה, ה-views, ה-seed
 * וההבטחות המבניות של §11) רץ כאן — פעם אחת: על מסד שכבר הוקם נדחה (הטיפוסים והטבלאות כבר קיימים,
 * ושינויי סכימה אחר כך עוברים migration עם גיבוי — הנחיה 10).
 * מאחורי שער הכניסה (middleware) — ובענן בלי APP_PASSWORD כלום לא נפתח.
 */
export async function GET() {
  const [r] = await sql<{ ready: boolean }[]>`select to_regclass('public.crm_docs') is not null as ready`
  return NextResponse.json({ ready: !!r?.ready })
}

export async function POST() {
  const [st] = await sql<{ ready: boolean }[]>`select to_regclass('public.crm_docs') is not null as ready`
  if (st?.ready) return NextResponse.json({ code: 'already_exists', message: 'מסד הנתונים כבר מוקם' }, { status: 409 })
  // \set של psql אינו SQL — נשמט כשמריצים מכאן (בשגיאה הבקשה נכשלת ממילא)
  const bundle = (await readFile(join(process.cwd(), 'db', 'bundle.sql'), 'utf8')).replace(/^\\.*$/gm, '')
  // קובץ-קובץ, כל אחד בקריאה משלו: בדיקות ההבטחות עטופות ב-begin…rollback, ובקריאה אחת
  // ה-rollback היה מגלגל אחורה גם את כל הסכימה שלפניו
  // חיבור אחד שמור: postgres.js לא מריץ begin על pool משותף
  const conn = await sql.reserve()
  try {
    for (const part of bundle.split(/^(?=-- ─── )/m)) {
      const file = part.match(/^-- ─── (\S+)/)?.[1]
      if (!file) continue
      try { await conn.unsafe(part) }
      catch (e) { return NextResponse.json({ code: 'upstream_error', message: `${file}: ${(e as Error).message}` }, { status: 500 }) }
    }
  } finally { conn.release() }
  const [r] = await sql<{ tables: number; views: number }[]>`
    select (select count(*)::int from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
           (select count(*)::int from information_schema.views where table_schema = 'public') as views`
  return NextResponse.json({ ok: true, ...r })
}
