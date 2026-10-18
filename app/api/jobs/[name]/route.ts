import { NextResponse } from 'next/server'
import { envSecret, secretEq } from '@/lib/secret'
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
import { crmMirrorJob } from '@/lib/jobs/crm-mirror'
import { attendanceWatchJob } from '@/lib/jobs/attendance-watch'

export const dynamic = 'force-dynamic'

/**
 * הפעלת ג'וב מחלק ג' של ה-ADDENDUM דרך HTTP — כך ה-cron (Supabase / GitHub Actions / crontab)
 * מריץ את אותו קוד שהמסך מריץ. מוגן ב-JOBS_SECRET (header `x-jobs-secret`; לא בכתובת — כתובות נשמרות ביומני גישה).
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
  crm_mirror: (d: string) => crmMirrorJob(d),
  /** לא בחלק ג' — סטייה שדן אישר (17/10/26): נוכחות כשהמערכת סגורה */
  attendance_watch: (d: string) => attendanceWatchJob(d),
} as const

/**
 * הרשאה: `x-jobs-secret` (ה-cron שלנו), או `Authorization: Bearer $CRON_SECRET`
 * (הפורמט ש-Vercel Cron שולח). בלי סוד מוגדר — רק בפיתוח. רווחים בקצוות לא נחשבים (lib/secret.ts).
 */
function authorized(req: Request): { ok: boolean; why?: Record<string, boolean> } {
  const secret = envSecret('JOBS_SECRET'), cronSecret = envSecret('CRON_SECRET')
  if (!secret && !cronSecret) return { ok: process.env.NODE_ENV !== 'production', why: { serverHasSecret: false } }
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const given = req.headers.get('x-jobs-secret') ?? ''
  if (secretEq(given, secret) || secretEq(bearer, secret) || secretEq(bearer, cronSecret)) return { ok: true }
  // לאבחון בלי לחשוף את הסוד: רק מה הגיע ומה מוגדר — אף פעם לא ערכים
  return { ok: false, why: { serverHasSecret: true, sentJobsHeader: Boolean(given.trim()), sentBearer: Boolean(bearer.trim()) } }
}

async function run(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const auth = authorized(req)
  if (!auth.ok) return NextResponse.json({ error: 'לא מורשה', ...auth.why }, { status: 401 })
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
