import { Users } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { activeAlertCount } from '@/lib/queries/common'
import { listTerms, payrollForMonth, payrollHistory, payrollTotals } from '@/lib/queries/payroll'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { PayrollView } from './client'

export const dynamic = 'force-dynamic'

/**
 * מסך 19 — שכר עובדים (SPEC §3.9, §5).
 * "תחשיב עם הסבר לכל שורה, אישור, PDF+XLSX לרו"ח, מעקב תשלום."
 * החודש שאושר מוצג מהתצלום השמור ולא מחושב מחדש.
 */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const [lines, terms, history, alerts] = await Promise.all([
    payrollForMonth(period), listTerms(), payrollHistory(), activeAlertCount(),
  ])

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Users size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">שכר עובדים</h1>
          <span className="text-xs text-text-3">
            כל רכיב מוצג עם ההסבר שלו (§3.9) · חודש שאושר אינו נערך — תיקון הוא התאמה ידנית בחודש הבא
          </span>
        </div>
        <PayrollView period={period} lines={lines} terms={terms} totals={payrollTotals(lines)} history={history} />
      </main>
    </>
  )
}
