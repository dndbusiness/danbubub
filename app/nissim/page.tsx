import { Lock } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { LockedSkeleton, PinGate, PinNotConfigured } from '@/components/pin-gate'
import { verifyPin } from '@/app/actions/pin'
import { pinConfigured, pinUnlockedUntil } from '@/lib/pin'
import { settlementTransferCandidates } from '@/app/actions/periods'
import { askNissimCount, closingBlockers, nissimCardFor, nissimCardHistory, nissimDrill, periodFor } from '@/lib/queries/nissim'
import { activeAlertCount } from '@/lib/queries/common'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { NissimCardView } from './card'

export const dynamic = 'force-dynamic'

/**
 * מסך 7 — כרטיס ניסים 🔒. SPEC §3.3, §5, UIUX §5.3.
 * "ניסים רואה אותו מסך, ללא כפתור 'סגור חודש' וללא יתרת בנק."
 */
export default async function NissimPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period } = readGlobalParams(sp, now)
  const until = await pinUnlockedUntil('nissim')
  const [period_, alerts, configured] = await Promise.all([periodFor(period), activeAlertCount(), pinConfigured('nissim')])
  // הנתונים נטענים רק כשהאזור פתוח (עוגייה חתומה בשרת)
  const data = until ? await Promise.all([
    nissimCardFor(period), nissimCardHistory(), nissimDrill(period), closingBlockers(period), askNissimCount(period), settlementTransferCandidates(period),
  ]) : null

  async function verify(pin: string) {
    'use server'
    return verifyPin('nissim', pin)
  }

  return (
    <>
      <Topbar period={period} division="finance" periodLocked={period_?.status === 'closed'} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5 max-w-5xl">
        <div className="flex items-center gap-3">
          <Lock size={20} className="text-div-finance" />
          <h1 className="text-xl font-semibold">כרטיס ניסים — התחשבנות 50/50</h1>
        </div>
        {!configured ? (
          <PinNotConfigured />
        ) : (
          <PinGate area="nissim" areaLabel="כרטיס ניסים" verify={verify} unlockedUntil={until}>
            {data ? (
              <NissimCardView
                month={period} card={data[0]} history={data[1]} period={period_} drill={data[2]} blockers={data[3]}
                askNissim={data[4]} candidates={data[5]} canClose
              />
            ) : <LockedSkeleton />}
          </PinGate>
        )}
      </main>
    </>
  )
}
