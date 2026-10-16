import { CalendarClock, Plus } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { fixedExpenseMonths, listFixedExpenses } from '@/lib/queries/fixed-expenses'
import { activeAlertCount, listAccounts, listCategories } from '@/lib/queries/common'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { formatMonth } from '@/lib/ui/format'
import { FixedExpensesList } from './list'
import { NewFixedExpenseForm } from './new-fixed'

export const dynamic = 'force-dynamic'

/**
 * מסך 6 — הוצאות קבועות. SPEC §5 + ADDENDUM ב.9 "כרטיס הוצאה קבועה":
 * לכל הוצאה שורת 12 חודשים: צפוי / בפועל / ✓ שודך / ✗ לא ירד / ⚠ סכום שונה.
 * "שולם על חודש 08" = כל השורות של 08 ✓.
 */
export default async function FixedExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const all = await listFixedExpenses()
  const expenses = all.filter((f) => division === 'all' || f.division === division || f.division === 'shared')
  const [months, alerts, categories, accounts] = await Promise.all([
    fixedExpenseMonths(expenses, period, now.slice(0, 10)),
    activeAlertCount(), listCategories(), listAccounts(),
  ])

  const active = expenses.filter((f) => f.active)
  const share = (f: (typeof expenses)[number]) => {
    if (division === 'all' || f.division !== 'shared') return Math.abs(f.amount_net)
    return Math.abs(f.amount_net) * (f.division_split?.[division] ?? 0)
  }
  const monthly = active.filter((f) => f.frequency === 'monthly')
  const approved = monthly.filter((f) => f.approved_by_nissim)
  const thisMonth = active.map((f) => months.get(f.id)?.at(-1)).filter((m) => m && m.status !== 'not_due')
  const matched = thisMonth.filter((m) => m!.status === 'matched').length
  const missing = thisMonth.filter((m) => m!.status === 'missing')

  const drill = (list: typeof expenses) => (
    <ul className="divide-y divide-border text-sm">
      {list.map((f) => <li key={f.id} className="flex justify-between py-2"><span>{f.name}</span><Money value={-share(f)} /></li>)}
    </ul>
  )

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <CalendarClock size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">הוצאות קבועות — {formatMonth(period)}</h1>
          <div className="ms-auto">
            <NewFixedExpenseForm categories={categories} accounts={accounts} trigger={<Button variant="primary"><Plus size={16} /> הוצאה קבועה</Button>} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="לוח חודשי" value={monthly.reduce((a, f) => a + share(f), 0)} nature="open" subtitle={`${monthly.length} הוצאות`} drill={drill(monthly)} />
          <KpiCard title="מאושר 50/50" value={approved.reduce((a, f) => a + share(f), 0)} certainty="committed" subtitle="נכנס לרווח לחלוקה" drill={drill(approved)} />
          <KpiCard title="ירד החודש" value={matched} count certainty="actual" subtitle={`מתוך ${thisMonth.length}`} drill={drill(active.filter((f) => months.get(f.id)?.at(-1)?.status === 'matched'))} />
          <KpiCard title="לא ירד כמצופה" value={missing.length} count nature={missing.length ? 'open' : 'locked'} subtitle="5 ימים אחרי היום הצפוי → התראה" drill={drill(active.filter((f) => months.get(f.id)?.at(-1)?.status === 'missing'))} />
        </div>

        <FixedExpensesList expenses={expenses} months={Object.fromEntries(months)} />
      </main>
    </>
  )
}
