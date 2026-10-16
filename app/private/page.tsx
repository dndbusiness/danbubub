import { Lock } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { LockedSkeleton, PinGate, PinNotConfigured } from '@/components/pin-gate'
import { verifyPin } from '@/app/actions/pin'
import { pinConfigured, pinUnlockedUntil } from '@/lib/pin'
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
  // הנתונים נטענים רק כשהאזור פתוח (עוגייה חתומה בשרת) — נעול = לא יוצא מהשרת בכלל
  const until = await pinUnlockedUntil('private')
  const rows = until ? await privateRows() : []
  const [summary, alerts, configured] = await Promise.all([
    until ? privateSummary(rows) : null, activeAlertCount(), pinConfigured('private'),
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
          <PinNotConfigured />
        ) : (
          <PinGate area="private" areaLabel="הכנסות פרייבט" verify={verify} unlockedUntil={until}>
            {until && summary ? <PrivateView rows={rows} summary={summary} /> : <LockedSkeleton />}
          </PinGate>
        )}
      </main>
    </>
  )
}
