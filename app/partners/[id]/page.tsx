import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, Lock } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { LockedSkeleton, PinGate, PinNotConfigured } from '@/components/pin-gate'
import { verifyPin } from '@/app/actions/pin'
import { pinConfigured, pinUnlockedUntil } from '@/lib/pin'
import { activeAlertCount } from '@/lib/queries/common'
import { investorLoans, partnerById, partnerDraws, partnerPositions, partnerYears, realEstateMonths } from '@/lib/queries/partners'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { PartnerCard } from './card'

export const dynamic = 'force-dynamic'

/**
 * מסך 8, תצוגת שותף יחיד — קריטריון §9 שלב 7: "אביב ויוני רואים את חלקם".
 * מוצג כאן רק החלק של השותף הזה: היעד שלו, מה משך, הסטייה, החו״ז שלו
 * והמשיכות שלו. המשיכות של האחרים לא מופיעות.
 */
export default async function PartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period } = readGlobalParams(sp, now)

  const partner = await partnerById(id)
  if (!partner) notFound()

  const years = await partnerYears()
  const requested = typeof sp.year === 'string' ? sp.year : null
  const year = (requested && years.includes(requested) ? requested : years[0]) ?? period.slice(0, 4)

  const until = await pinUnlockedUntil('partners')
  const [alerts, configured] = await Promise.all([activeAlertCount(), pinConfigured('partners')])
  // הנתונים נטענים רק כשהאזור פתוח (עוגייה חתומה בשרת)
  const [positions, draws, months, loans] = until
    ? await Promise.all([partnerPositions(year), partnerDraws(year, id), realEstateMonths(year), investorLoans()])
    : [[], [], [], []] as [Awaited<ReturnType<typeof partnerPositions>>, Awaited<ReturnType<typeof partnerDraws>>, Awaited<ReturnType<typeof realEstateMonths>>, Awaited<ReturnType<typeof investorLoans>>]
  const mine = positions.find((p) => p.partner_id === id) ?? null
  const loan = loans.find((l) => l.partner_id === id) ?? null

  async function verify(pin: string) {
    'use server'
    return verifyPin('partners', pin)
  }

  return (
    <>
      <Topbar period={period} division="realestate" alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5 max-w-4xl">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/partners?year=${year}`} className="text-text-2 hover:text-text inline-flex items-center gap-1 text-sm">
            <ChevronRight size={16} /> משיכות שותפים
          </Link>
          <Lock size={20} className="text-div-realestate" />
          <h1 className="text-xl font-semibold">{partner.name} — החלק שלי ב-{year}</h1>
        </div>

        {!configured ? (
          <PinNotConfigured />
        ) : (
          <PinGate area="partners" areaLabel={`החלק של ${partner.name}`} verify={verify} unlockedUntil={until}>
            {!until ? <LockedSkeleton /> : <PartnerCard
              year={year} years={years.length ? years : [year]} partnerId={id} name={partner.name}
              payMethod={partner.pay_method} position={mine} draws={draws} months={months} loan={loan}
              partnerCount={positions.length}
            />}
          </PinGate>
        )}
      </main>
    </>
  )
}
