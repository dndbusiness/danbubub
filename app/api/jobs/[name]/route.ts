import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { dayCloseJob } from '@/lib/jobs/day-close'
import { alertsEvalJob } from '@/lib/jobs/alerts-eval'
import { anchorReminderJob } from '@/lib/jobs/anchor-reminder'

export const dynamic = 'force-dynamic'

/**
 * הפעלת ג'וב מחלק ג' של ה-ADDENDUM דרך HTTP — כך ה-cron (Supabase / GitHub Actions / crontab)
 * מריץ את אותו קוד שהמסך מריץ. מוגן ב-JOBS_SECRET (header `x-jobs-secret` או `?secret=`).
 *   POST /api/jobs/day_close?date=YYYY-MM-DD
 */
const JOBS = {
  day_close: (d: string) => dayCloseJob(d),
  alerts_eval: (d: string) => alertsEvalJob(d),
  anchor_reminder: (d: string) => anchorReminderJob(d),
} as const

function authorized(req: Request): boolean {
  const secret = process.env.JOBS_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const given = req.headers.get('x-jobs-secret') ?? new URL(req.url).searchParams.get('secret') ?? ''
  const a = Buffer.from(given), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: 'לא מורשה' }, { status: 401 })
  const { name } = await params
  const job = JOBS[name as keyof typeof JOBS]
  if (!job) return NextResponse.json({ error: `ג'וב לא מוכר: ${name}`, jobs: Object.keys(JOBS) }, { status: 404 })
  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date בפורמט YYYY-MM-DD' }, { status: 400 })
  try {
    const out = await job(date)
    return NextResponse.json({ job: name, date, ...out })
  } catch (e) {
    return NextResponse.json({ job: name, date, error: (e as Error).message }, { status: 500 })
  }
}
