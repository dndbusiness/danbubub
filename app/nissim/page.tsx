import { Lock } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { PinGate } from '@/components/pin-gate'
import { verifyPin, pinConfigured } from '@/app/actions/pin'
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
  const [card, history, period_, drill, blockers, ask, alerts, configured, candidates] = await Promise.all([
    nissimCardFor(period), nissimCardHistory(), periodFor(period), nissimDrill(period), closingBlockers(period),
    askNissimCount(period), activeAlertCount(), pinConfigured('nissim'), settlementTransferCandidates(period),
  ])

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
          <div className="bg-expected-bg text-expected rounded-[var(--radius-card)] p-4 text-sm">
            לא הוגדר קוד גישה לאזור זה. להגדרה: <code dir="ltr" className="font-mono">node scripts/set-pin.mjs nissim ****</code>
          </div>
        ) : (
          <PinGate areaLabel="כרטיס ניסים" verify={verify}>
            <NissimCardView
              month={period} card={card} history={history} period={period_} drill={drill} blockers={blockers}
              askNissim={ask} candidates={candidates} canClose
            />
          </PinGate>
        )}
      </main>
    </>
  )
}
