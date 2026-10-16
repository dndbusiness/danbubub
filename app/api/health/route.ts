import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * בריאות המערכת — לניטור חיצוני ול-preflight.
 * מחזיר 200 כשה-DB עונה והסכימה במקום; 503 אחרת. לא חושף נתונים עסקיים.
 */
export async function GET() {
  const started = Date.now()
  try {
    const [[db], [schema], [jobs], [outbox]] = await Promise.all([
      sql<{ now: string }[]>`select now()::text as now`,
      sql<{ tables: number; views: number }[]>`
        select (select count(*)::int from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
               (select count(*)::int from information_schema.views where table_schema = 'public') as views`,
      sql<{ name: string; last: string | null; failed: number }[]>`
        select job_name as name, max(started_at)::text as last, count(*) filter (where status = 'failed')::int as failed
        from scheduled_jobs_log where started_at > now() - interval '48 hours' group by job_name`,
      sql<{ pending: number; failed: number }[]>`
        select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'failed')::int as failed
        from outbox where deleted_at is null`,
    ])
    const ok = (schema?.tables ?? 0) >= 40 && (schema?.views ?? 0) >= 20
    return NextResponse.json({
      status: ok ? 'ok' : 'degraded',
      db: { connected: true, now: db?.now, tables: schema?.tables, views: schema?.views },
      jobs48h: jobs, outbox, latencyMs: Date.now() - started,
    }, { status: ok ? 200 : 503 })
  } catch (e) {
    return NextResponse.json({ status: 'down', error: (e as Error).message, latencyMs: Date.now() - started }, { status: 503 })
  }
}
