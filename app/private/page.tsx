import { Lock } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { PinGate } from '@/components/pin-gate'
import { pinConfigured, verifyPin } from '@/app/actions/pin'
import { activeAlertCount } from '@/lib/queries/common'
import { privateRows, privateSummary } from '@/lib/queries/private'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { PrivateView } from './client'

export const dynamic = 'force-dynamic'

/**
 * מסך 9 — הכנסות פרייבט 🔒 (SPEC §2.1, §5).
 * "נפרד לחלוטין מהחברה" — המסך הזה לא נוגע ב-transactions, לא ב-P&L ולא במע"מ
 * של החברה. רק הקרנות, הסף, הצפוי מול שהתקבל, והחלוקה דן/ניסים.
 */
export default async function PrivatePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period } = readGlobalParams(sp, new Date().toISOString())
  const rows = await privateRows()
  const [summary, alerts, configured] = await Promise.all([
    privateSummary(rows), activeAlertCount(), pinConfigured('private'),
  ])

  async function verify(pin: string) {
    'use server'
    return verifyPin('private', pin)
  }

  return (
    <>
      <Topbar period={period} division="finance" alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Lock size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">הכנסות פרייבט</h1>
          <span className="text-xs text-text-3">נפרד לחלוטין מהחברה — לא נכנס לרווח, לא למע״מ ולא לתזרים (§2.1)</span>
        </div>

        {!configured ? (
          <div className="bg-expected-bg text-expected rounded-[var(--radius-card)] p-4 text-sm">
            לא הוגדר קוד גישה לאזור זה. להגדרה: <code dir="ltr" className="font-mono">node scripts/set-pin.mjs private ****</code>
          </div>
        ) : (
          <PinGate area="private" areaLabel="הכנסות פרייבט" verify={verify}>
            <PrivateView rows={rows} summary={summary} />
          </PinGate>
        )}
      </main>
    </>
  )
}
