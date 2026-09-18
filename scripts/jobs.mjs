/**
 * הרצת ג'וב מתוזמן מחלק ג' של ה-ADDENDUM, דרך השרת (אותו קוד שהמסך מריץ; נרשם ב-scheduled_jobs_log):
 *   node scripts/jobs.mjs day_close|alerts_eval|anchor_reminder|daily_summary|gmail_scan|drive_intake_scan|calendar_sync|weekly_report|pnl_draft|pnl_final|accountant_pack|deal_decay|db_backup|greeninvoice_import [YYYY-MM-DD]
 *
 * תזמון (Asia/Jerusalem) לפי חלק ג': day_close 06:30 · alerts_eval 06:45 · daily_summary 07:30 א׳–ו׳ · anchor_reminder 08:30.
 * crontab לדוגמה:  30 6 * * *  cd /srv/harel && node scripts/jobs.mjs day_close
 * סביבה: BASE_URL (ברירת מחדל http://localhost:3000), JOBS_SECRET (חובה ב-production),
 *        ובשרת: GREEN_API_ID_INSTANCE + GREEN_API_TOKEN לוואטסאפ.
 */
import { readFileSync, existsSync } from 'node:fs'

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const [name, dateArg] = process.argv.slice(2)
if (!name) { console.error('שימוש: node scripts/jobs.mjs <day_close|alerts_eval|anchor_reminder|daily_summary|gmail_scan|drive_intake_scan|calendar_sync|weekly_report|pnl_draft|pnl_final|accountant_pack|deal_decay|db_backup|greeninvoice_import> [YYYY-MM-DD]'); process.exit(1) }
const base = process.env.BASE_URL ?? 'http://localhost:3000'
const url = new URL(`/api/jobs/${name}`, base)
if (dateArg) url.searchParams.set('date', dateArg)
const res = await fetch(url, { method: 'POST', headers: process.env.JOBS_SECRET ? { 'x-jobs-secret': process.env.JOBS_SECRET } : {} })
const body = await res.json().catch(() => ({}))
console.log(JSON.stringify(body, null, 2))
process.exit(res.ok ? 0 : 1)
