import { Bell } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { RiskBanner } from '@/components/risk-banner'
import { activeAlertCount } from '@/lib/queries/common'
import { listAlerts, riskMode } from '@/lib/queries/dashboard'
import { settingValues } from '@/lib/queries/cashflow'
import { sql } from '@/lib/db'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { AlertsList } from './list'

export const dynamic = 'force-dynamic'

/** התראות — ADDENDUM ב.11. הפעמון בפס העליון מוביל לכאן. */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const [alerts, count, risk, s, lastRun] = await Promise.all([
    listAlerts({ includeResolved: true }), activeAlertCount(), riskMode(), settingValues(['notify_whatsapp_dan', 'notify_email_dan']),
    sql<{ at: string | null; status: string | null; error: string | null }[]>`
      select started_at::text as at, status, error from scheduled_jobs_log where job_name = 'alerts_eval' order by started_at desc limit 1`,
  ])
  return (
    <>
      <Topbar period={period} division={division} alertCount={count} />
      {risk.is_risk_mode && <RiskBanner message={`${risk.critical_count} התראות קריטיות פעילות`} />}
      <main className="p-4 md:p-6 flex flex-col gap-5 max-w-3xl">
        <div className="flex items-center gap-3">
          <Bell size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">התראות</h1>
          <span className="text-xs text-text-3">{count} פעילות · "התראה = משהו שדורש החלטה, לא רעש"</span>
        </div>
        <AlertsList
          alerts={alerts}
          targets={{ whatsapp: typeof s.notify_whatsapp_dan === 'string' ? s.notify_whatsapp_dan : null, email: typeof s.notify_email_dan === 'string' ? s.notify_email_dan : null }}
          lastRun={lastRun[0] ?? null}
          today={now.slice(0, 10)}
        />
      </main>
    </>
  )
}
