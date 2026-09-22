import { BarChart3 } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { activeAlertCount } from '@/lib/queries/common'
import {
  channelProductGrid, conversionFlags, conversionWeeks, funnel, leadCosts, leadSources,
  listLeads, sourceSummary, submissionStats,
} from '@/lib/queries/leads'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { LeadsView } from './client'

export const dynamic = 'force-dynamic'

/**
 * מסך 14 — לידים והמרה (SPEC §3.8, §5, §5.1).
 * "המשפך שלנו: לידים → קשר → פגישה → חתם → נגבה. **עם ₪ בכל שלב**" —
 * עלות הלידים בצד אחד, שכ"ט שנחתם ונגבה בצד השני.
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const [weeks, stages, sources, grid, leads, costs, allSources, subs, alerts] = await Promise.all([
    conversionWeeks(13), funnel(90), sourceSummary(90), channelProductGrid(90),
    listLeads(), leadCosts(90), leadSources(), submissionStats(), activeAlertCount(),
  ])
  const flags = conversionFlags(weeks, now.slice(0, 10))

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <BarChart3 size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">לידים והמרה</h1>
          <span className="text-xs text-text-3">
            המשפך ב-₪ ולא בכמויות (§3.8) · WISE נשארת מקור האמת ללידים — כאן רק מה שהם שווים
          </span>
        </div>
        <LeadsView
          weeks={weeks} stages={stages} sources={sources} grid={grid} leads={leads}
          costs={costs} allSources={allSources} submissions={subs} flags={flags}
        />
      </main>
    </>
  )
}
