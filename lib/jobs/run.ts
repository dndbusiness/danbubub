import { sql } from '@/lib/db'

/** חלק ג' — "כל ריצה נרשמת ב-scheduled_jobs_log (התחלה, סיום, סטטוס, שורות שנגעו, שגיאה)". */
export type JobName = 'day_close' | 'alerts_eval' | 'anchor_reminder' | 'daily_summary' | 'gmail_scan' | 'drive_intake_scan' | 'calendar_sync' | 'weekly_report' | 'deal_decay'

export interface JobOutcome { rowsTouched: number; detail?: Record<string, unknown>; skipped?: string }

export async function runJob<T extends JobOutcome>(name: JobName, fn: () => Promise<T>): Promise<T> {
  const [log] = await sql<{ id: number }[]>`insert into scheduled_jobs_log (job_name) values (${name}) returning id`
  try {
    const out = await fn()
    await sql`
      update scheduled_jobs_log
      set finished_at = now(), status = ${out.skipped ? 'skipped' : 'succeeded'}, rows_touched = ${out.rowsTouched},
          error = ${out.skipped ?? null}, detail = ${out.detail ? sql.json(out.detail as never) : null}
      where id = ${log!.id}`
    return out
  } catch (e) {
    await sql`update scheduled_jobs_log set finished_at = now(), status = 'failed', error = ${(e as Error).message} where id = ${log!.id}`
    throw e
  }
}

export async function lastJobRuns(days = 7) {
  return sql<{ job_name: string; runs_7d: number; succeeded: number; failed: number; last_run_at: string | null; last_success_at: string | null; last_error: string | null }[]>`
    select job_name, runs_7d::int, succeeded::int, failed::int, last_run_at::text, last_success_at::text, last_error from v_system_health order by job_name`
}
