import { Lock } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { LockedSkeleton, PinGate, PinNotConfigured } from '@/components/pin-gate'
import { verifyPin } from '@/app/actions/pin'
import { pinConfigured, pinUnlockedUntil } from '@/lib/pin'
import { activeAlertCount } from '@/lib/queries/common'
import {
  cashDiscountRows, investorLoans, partnerDraws, partnerPositions, partnerYears,
  realEstateMonths, realEstatePartners,
} from '@/lib/queries/partners'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { PartnersView } from './client'

export const dynamic = 'force-dynamic'

/**
 * מסך 8 — משיכות שותפים נדל"ן 🔒 (SPEC §3.5, §5).
 * 33/33/33: רווח לחלוקה ÷ שותפים = היעד; מה שנמשך מולו; והסטייה.
 * חו"ז הבעלים, חוב המשקיע ונכיון המזומן — כל אחד בנפרד, כמו שהאפיון דורש.
 */
export default async function PartnersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period } = readGlobalParams(sp, now)
  const years = await partnerYears()
  const requested = typeof sp.year === 'string' ? sp.year : null
  const year = (requested && years.includes(requested) ? requested : years[0]) ?? period.slice(0, 4)

  const until = await pinUnlockedUntil('partners')
  const [alerts, configured] = await Promise.all([activeAlertCount(), pinConfigured('partners')])
  // הנתונים נטענים רק כשהאזור פתוח (עוגייה חתומה בשרת)
  const data = until ? await Promise.all([
    partnerPositions(year), realEstateMonths(year), partnerDraws(year), investorLoans(),
    cashDiscountRows(year), realEstatePartners(),
  ]) : null

  async function verify(pin: string) {
    'use server'
    return verifyPin('partners', pin)
  }

  return (
    <>
      <Topbar period={period} division="realestate" alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Lock size={20} className="text-div-realestate" />
          <h1 className="text-xl font-semibold">משיכות שותפים — נדל״ן 33/33/33</h1>
          <span className="text-xs text-text-3">היעד הוא הרווח לחלוקה חלקי מספר השותפים, מצטבר מתחילת השנה (§3.5)</span>
        </div>

        {!configured ? (
          <PinNotConfigured />
        ) : (
          <PinGate area="partners" areaLabel="משיכות שותפים" verify={verify} unlockedUntil={until}>
            {data ? (
              <PartnersView
                year={year} years={years.length ? years : [year]} positions={data[0]} months={data[1]}
                draws={data[2]} loans={data[3]} cashDiscount={data[4]} partners={data[5]}
              />
            ) : <LockedSkeleton />}
          </PinGate>
        )}
      </main>
    </>
  )
}
