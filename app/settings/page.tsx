import Link from 'next/link'
import { Activity, Settings } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/status-pill'
import { activeAlertCount } from '@/lib/queries/common'
import { googleIntegration } from '@/lib/google/store'
import { lastJobRuns } from '@/lib/jobs/run'
import { settingValues } from '@/lib/queries/cashflow'
import { sql } from '@/lib/db'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { GoogleCard } from './google-card'
import { CalendarCard } from './calendar-card'
import { hasScope } from '@/lib/google/store'

export const dynamic = 'force-dynamic'

/** מסך 18 — הגדרות (בשלב זה: חיבורים, בריאות המערכת, דוחות שהופקו). הרשימות הסגורות ומיפויי הייבוא — בהמשך. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period, division } = readGlobalParams(sp, new Date().toISOString())
  const [alerts, integ, jobs, s, reports] = await Promise.all([
    activeAlertCount(), googleIntegration(), lastJobRuns(), settingValues(['notify_whatsapp_dan', 'notify_email_dan', 'notify_email_nissim', 'notify_email_hadas', 'calendar_ids', 'payroll_pay_day', 'payroll_approval_day', 'accountant_close_day', 'vat_day', 'vat_bimonthly', 'greeninvoice_intake_email']),
    sql<{ id: string; report_type: string; period: string | null; file_url: string | null; recipients: string[]; sent_at: string | null; created_at: string }[]>`
      select id, report_type, period, file_url, recipients, sent_at::text, created_at::text from report_runs where deleted_at is null order by created_at desc limit 15`,
  ])
  const env = {
    client: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), secretsKey: Boolean(process.env.SECRETS_KEY),
    greenApi: Boolean(process.env.GREEN_API_ID_INSTANCE && process.env.GREEN_API_TOKEN), jobsSecret: Boolean(process.env.JOBS_SECRET),
  }
  const notice = sp.google === 'connected' ? { kind: 'ok', text: `גוגל חובר: ${sp.email ?? ''}` } : sp.google === 'error' ? { kind: 'error', text: `החיבור נכשל: ${sp.reason ?? ''}` } : null
  const REPORT: Record<string, string> = { daily_summary: 'סיכום יומי', nissim_settlement: 'התחשבנות ניסים', pnl: 'רווח והפסד', weekly: 'דוח שבועי' }

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5 max-w-4xl">
        <div className="flex items-center gap-3"><Settings size={20} className="text-text-2" /><h1 className="text-xl font-semibold">הגדרות</h1></div>

        <GoogleCard integ={integ} env={env} notice={notice} />
        <CalendarCard values={s} calendarConnected={hasScope(integ, 'https://www.googleapis.com/auth/calendar.events')} />

        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">ערוצים ומפתחות</h2>
          <ul className="text-sm flex flex-col gap-1">
            <li className="flex items-center gap-2">וואטסאפ (Green-API) {env.greenApi ? <StatusPill tone="actual">מוגדר</StatusPill> : <StatusPill tone="open">חסר GREEN_API_ID_INSTANCE / GREEN_API_TOKEN</StatusPill>}</li>
            <li className="flex items-center gap-2">יעד וואטסאפ של דן {typeof s.notify_whatsapp_dan === 'string' ? <StatusPill tone="actual">{s.notify_whatsapp_dan}</StatusPill> : <StatusPill tone="open">לא הוגדר</StatusPill>} <Link href="/alerts" className="underline text-xs">עריכה במסך ההתראות</Link></li>
            <li className="flex items-center gap-2">מייל של דן (סיכום יומי) {typeof s.notify_email_dan === 'string' ? <StatusPill tone="actual">{s.notify_email_dan}</StatusPill> : <StatusPill tone="open">לא הוגדר</StatusPill>}</li>
            <li className="flex items-center gap-2">הגנה על ג׳ובים (JOBS_SECRET) {env.jobsSecret ? <StatusPill tone="actual">מוגדר</StatusPill> : <StatusPill tone="expected">לא מוגדר — מותר רק בפיתוח</StatusPill>}</li>
          </ul>
        </Card>

        <Card className="flex flex-col gap-2">
          <div className="flex items-center gap-2"><Activity size={16} className="text-text-2" /><h2 className="font-semibold">בריאות המערכת — 7 ימים</h2><span className="text-xs text-text-3">ADDENDUM חלק ג׳ · scheduled_jobs_log</span></div>
          {jobs.length ? (
            <div className="overflow-x-auto"><table className="text-sm w-full min-w-[560px]"><thead className="text-xs text-text-2"><tr><th className="text-start p-1">ג׳וב</th><th className="text-end p-1">ריצות</th><th className="text-end p-1">הצליחו</th><th className="text-end p-1">נכשלו</th><th className="text-start p-1">אחרונה</th><th className="text-start p-1">שגיאה אחרונה</th></tr></thead>
              <tbody>{jobs.map((j) => <tr key={j.job_name} className="border-t border-border"><td className="p-1 font-mono text-xs" dir="ltr">{j.job_name}</td><td className="p-1 text-end tnum">{j.runs_7d}</td><td className="p-1 text-end tnum text-actual">{j.succeeded}</td><td className={`p-1 text-end tnum ${j.failed ? 'text-open' : ''}`}>{j.failed}</td><td className="p-1 text-xs">{j.last_run_at?.slice(0, 16).replace('T', ' ')}</td><td className="p-1 text-xs text-open truncate max-w-[220px]">{j.last_error ?? ''}</td></tr>)}</tbody></table></div>
          ) : <p className="text-sm text-text-3">עדיין לא רץ ג׳וב. cron: 06:30 day_close · 06:45 alerts_eval · 07:30 daily_summary · 08:30 anchor_reminder.</p>}
        </Card>

        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">דוחות שהופקו</h2>
          <p className="text-xs text-text-3">ADDENDUM ב.9 report_runs — "שלח שוב" ו"מה נשלח בחודש X".</p>
          {reports.length ? (
            <ul className="divide-y divide-border text-sm">{reports.map((r) => <li key={r.id} className="flex flex-wrap gap-2 py-1"><span className="font-medium">{REPORT[r.report_type] ?? r.report_type}</span><span className="text-text-2">{r.period}</span>{r.period && r.report_type === 'daily_summary' && <a href={`/reports/daily/${r.period}`} target="_blank" className="underline text-xs">צפייה</a>}{r.file_url?.startsWith('http') && <a href={r.file_url} target="_blank" className="underline text-xs">דרייב</a>}<span className="ms-auto text-xs text-text-3">{r.recipients.length ? `נמענים: ${r.recipients.join(', ')}` : ''} {r.created_at.slice(0, 16).replace('T', ' ')}</span></li>)}</ul>
          ) : <p className="text-sm text-text-3">אין עדיין.</p>}
        </Card>
      </main>
    </>
  )
}
