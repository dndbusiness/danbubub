import { TrendingUp } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { activeAlertCount } from '@/lib/queries/common'
import { loadForecast } from '@/lib/queries/forecast'
import type { Scenario } from '@/lib/rules/forecast'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { ForecastView } from './client'

export const dynamic = 'force-dynamic'

const SCENARIOS = new Set(['pessimistic', 'base', 'optimistic'])
const asScenario = (v: unknown, fallback: Scenario): Scenario =>
  typeof v === 'string' && SCENARIOS.has(v) ? (v as Scenario) : fallback

/**
 * מסך 13 — תחזית רבעונית (SPEC §3.7, §5).
 * "טאב נדל"ן / טאב מימון / מאוחד · 3 תרחישים · הנחות ניתנות לדריסה ·
 *  דיוק תחזית היסטורי."
 */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const asOf = now.slice(0, 10)

  // "מה אם" — דריסות מגיעות ב-URL, כדי שאפשר יהיה לשתף תרחיש בקישור.
  const overrides: Record<string, number> = {}
  for (const [k, v] of Object.entries(sp)) {
    if (!k.startsWith('o.') || typeof v !== 'string') continue
    const n = Number(v)
    if (Number.isFinite(n)) overrides[k.slice(2)] = n
  }

  const reScenario = asScenario(sp.re, 'base')
  const finScenario = asScenario(sp.fin, 'base')
  const [bundle, alerts] = await Promise.all([
    loadForecast(asOf, { months: 3, overrides, realEstateScenario: reScenario, financeScenario: finScenario }),
    activeAlertCount(),
  ])

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <TrendingUp size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">תחזית רבעונית</h1>
          <span className="text-xs text-text-3">
            מנוע נפרד לכל פעילות ומאוחד לחשבון (§3.7) · כל הנחה מציגה על כמה נתונים היא נשענת
          </span>
        </div>
        <ForecastView bundle={bundle} reScenario={reScenario} finScenario={finScenario} overrides={overrides} />
      </main>
    </>
  )
}
