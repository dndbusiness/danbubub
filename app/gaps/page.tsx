import { FileWarning } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { RiskBanner } from '@/components/risk-banner'
import { activeAlertCount } from '@/lib/queries/common'
import { riskMode } from '@/lib/queries/dashboard'
import { gapLines, gapsByMonth, greenInvoiceSummary, lastReportRun, partnerInvoicesPending } from '@/lib/queries/gaps'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { GapsView } from './client'

export const dynamic = 'force-dynamic'

/**
 * מסך 12 — פערי חשבוניות (SPEC §4.3). שלוש הבדיקות, 12 חודשים אחורה,
 * ושליחה לרו"ח — קריטריון הסיום של שלב 6.
 */
export default async function GapsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period, division } = readGlobalParams(sp, new Date().toISOString())
  const [months, lines, partners, gi, alerts, risk, lastRun] = await Promise.all([
    gapsByMonth(), gapLines(), partnerInvoicesPending(), greenInvoiceSummary(),
    activeAlertCount(), riskMode(), lastReportRun('invoice_gaps'),
  ])

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      {risk.is_risk_mode && <RiskBanner message={`${risk.critical_count} התראות קריטיות פעילות`} />}
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <FileWarning size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">פערי חשבוניות</h1>
          <span className="text-xs text-text-3">שלוש הבדיקות של §4.3 · 12 חודשים אחורה · המע״מ בסיכון הוא כסף אמיתי שהולך לאיבוד</span>
        </div>
        <GapsView months={months} lines={lines} partners={partners} greenInvoice={gi} lastRun={lastRun} />
      </main>
    </>
  )
}
