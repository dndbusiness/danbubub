import { Lock } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { PinGate } from '@/components/pin-gate'
import { pinConfigured, verifyPin } from '@/app/actions/pin'
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

  const [positions, months, draws, loans, cash, partners, alerts, configured] = await Promise.all([
    partnerPositions(year), realEstateMonths(year), partnerDraws(year), investorLoans(),
    cashDiscountRows(year), realEstatePartners(), activeAlertCount(), pinConfigured('partners'),
  ])

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
          <div className="bg-expected-bg text-expected rounded-[var(--radius-card)] p-4 text-sm">
            לא הוגדר קוד גישה לאזור זה. להגדרה: <code dir="ltr" className="font-mono">node scripts/set-pin.mjs partners ****</code>
          </div>
        ) : (
          <PinGate area="partners" areaLabel="משיכות שותפים" verify={verify}>
            <PartnersView
              year={year} years={years.length ? years : [year]} positions={positions} months={months}
              draws={draws} loans={loans} cashDiscount={cash} partners={partners}
            />
          </PinGate>
        )}
      </main>
    </>
  )
}
