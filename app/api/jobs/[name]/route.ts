import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { dayCloseJob } from '@/lib/jobs/day-close'
import { alertsEvalJob } from '@/lib/jobs/alerts-eval'
import { anchorReminderJob } from '@/lib/jobs/anchor-reminder'
import { dailySummaryJob } from '@/lib/jobs/daily-summary'
import { gmailScanJob } from '@/lib/jobs/gmail-scan'
import { driveIntakeScanJob } from '@/lib/jobs/drive-intake-scan'
import { calendarSyncJob } from '@/lib/jobs/calendar-sync'
import { accountantPackJob, pnlReportJob, weeklyReportJob } from '@/lib/jobs/reports'
import { dbBackupJob, dealDecayJob } from '@/lib/jobs/maintenance'
import { greenInvoiceImportJob } from '@/lib/jobs/greeninvoice'
import { wiseImportJob } from '@/lib/jobs/wise'
import { accountantPayrollSendJob, payrollReminderJob } from '@/lib/jobs/payroll'
import { coldBackupJob, reportsToDriveJob } from '@/lib/jobs/backup'

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
  daily_summary: (d: string) => dailySummaryJob(d),
  gmail_scan: (d: string) => gmailScanJob(d),
  drive_intake_scan: (d: string) => driveIntakeScanJob(d),
  calendar_sync: (d: string) => calendarSyncJob(d),
  weekly_report: (d: string) => weeklyReportJob(d),
  pnl_draft: (d: string) => pnlReportJob(d, 'draft'),
  pnl_final: (d: string) => pnlReportJob(d, 'final'),
  accountant_pack: (d: string) => accountantPackJob(d),
  deal_decay: (d: string) => dealDecayJob(d),
  db_backup: (d: string) => dbBackupJob(d),
  greeninvoice_import: (d: string) => greenInvoiceImportJob(d),
  wise_import: (d: string) => wiseImportJob(d),
  payroll_reminder: (d: string) => payrollReminderJob(d),
  accountant_payroll_send: (d: string) => accountantPayrollSendJob(d),
  reports_to_drive: (d: string) => reportsToDriveJob(d),
  cold_backup: (d: string) => coldBackupJob(d),
} as const

const eq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * הרשאה: `x-jobs-secret` / `?secret=` (ה-cron שלנו), או `Authorization: Bearer $CRON_SECRET`
 * (הפורמט ש-Vercel Cron שולח). בלי סוד מוגדר — רק בפיתוח.
 */
function authorized(req: Request): boolean {
  const secret = process.env.JOBS_SECRET
  const cronSecret = process.env.CRON_SECRET
  if (!secret && !cronSecret) return process.env.NODE_ENV !== 'production'
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const given = req.headers.get('x-jobs-secret') ?? new URL(req.url).searchParams.get('secret') ?? ''
  return (Boolean(secret) && (eq(given, secret!) || eq(bearer, secret!))) || (Boolean(cronSecret) && eq(bearer, cronSecret!))
}

async function run(req: Request, { params }: { params: Promise<{ name: string }> }) {
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

export const POST = run
/** Vercel Cron שולח GET. אותה פעולה בדיוק. */
export const GET = run
