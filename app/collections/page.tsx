import { Coins } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { RiskBanner } from '@/components/risk-banner'
import { activeAlertCount } from '@/lib/queries/common'
import { agingSummary, collectionFlags, executionPipeline, listCollections } from '@/lib/queries/collections'
import { riskMode } from '@/lib/queries/dashboard'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { CollectionsView } from './client'

export const dynamic = 'force-dynamic'

/** מסך 20 — גביה (ADDENDUM ב.6) + טאב "לביצוע וגביה" (ב.5). */
export default async function CollectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period, division } = readGlobalParams(sp, new Date().toISOString())
  const [rows, aging, flags, pipeline, alerts, risk] = await Promise.all([
    listCollections(division), agingSummary(division), collectionFlags(), executionPipeline(), activeAlertCount(), riskMode(),
  ])
  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      {risk.is_risk_mode && <RiskBanner message={`${risk.critical_count} התראות קריטיות פעילות`} />}
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Coins size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">גביה</h1>
          <span className="text-xs text-text-3">גיול לפי תאריך היעד · המערכת לא מנפיקה מסמכי מס — חשבונית ירוקה נשארת המקור</span>
        </div>
        <CollectionsView rows={rows} aging={aging} flags={flags} pipeline={pipeline.rows} blockers={pipeline.blockers} />
      </main>
    </>
  )
}
