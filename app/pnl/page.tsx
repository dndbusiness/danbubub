import { BarChart3, Download } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { pnlByMonth, pnlExpenseLines, pnlIncomeLines, pnlTotals, type PnlMode } from '@/lib/queries/pnl'
import { activeAlertCount, isPeriodLocked } from '@/lib/queries/common'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { formatMonth } from '@/lib/ui/format'
import { PnlTables, PnlView } from './client'
import { MonthCloseChecklist } from './month-close'

export const dynamic = 'force-dynamic'

/**
 * מסך 2 — רווח והפסד. SPEC §3.2, §5: "מתג תפעולי/לחלוקה · מתג division · drill-down · PDF/הדפסה/XLSX".
 * "מסך אחד, מתג בין שתי ההגדרות, כותרת ברורה איזו מוצגת."
 */
export default async function PnlPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division: divParam } = readGlobalParams(sp, now)
  const division = divParam === 'realestate' ? 'realestate' : 'finance'
  const mode: PnlMode = sp.mode === 'operational' ? 'operational' : 'distributable'
  const [totals, other, expenses, income, byMonth, alerts, locked] = await Promise.all([
    pnlTotals(period, division, mode),
    pnlTotals(period, division, mode === 'operational' ? 'distributable' : 'operational'),
    pnlExpenseLines(period, division, mode),
    pnlIncomeLines(period, division, mode),
    pnlByMonth(division),
    activeAlertCount(),
    isPeriodLocked(period, division),
  ])

  const lines = (rows: typeof expenses) => (
    <ul className="divide-y divide-border text-sm">
      {rows.map((r) => <li key={r.key} className="flex justify-between py-2"><span>{r.label} <span className="text-text-3 text-xs">({r.count})</span></span><Money value={r.amount} /></li>)}
    </ul>
  )

  return (
    <>
      <Topbar period={period} division={division} periodLocked={locked} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <BarChart3 size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">
            רווח והפסד — {mode === 'operational' ? 'רווח תפעולי' : 'רווח לחלוקה'} · {division === 'finance' ? 'מימון' : 'נדל״ן'} · {formatMonth(period)}
          </h1>
          <a href={`/api/reports/pnl?period=${period}&division=${division}&mode=${mode}`} className="ms-auto inline-flex items-center gap-1 h-9 px-3 rounded-[var(--radius-btn)] border border-border bg-surface text-sm hover:bg-locked-bg"><Download size={14} /> PDF</a>
        </div>

        <PnlView mode={mode} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="הכנסות" value={totals.income} certainty="actual" division={division} drill={lines(income)} drillTitle="הכנסות לפי תיק" />
          <KpiCard title={mode === 'operational' ? 'הוצאות (הכל)' : 'הוצאות מוכרות'} value={totals.total_expenses} nature="open" division={division}
            subtitle={`קבועות ${Math.round(totals.fixed_expenses).toLocaleString('he-IL')} · ישירות ${Math.round(totals.direct_expenses).toLocaleString('he-IL')}`}
            drill={lines(expenses)} drillTitle="הוצאות לפי קטגוריה" />
          <KpiCard title={mode === 'operational' ? 'רווח תפעולי' : 'רווח לחלוקה'} value={totals.profit} division={division} drill={<p className="text-sm text-text-2">הכנסות − הוצאות. ההרכב בשני הכרטיסים משמאל.</p>} />
          <KpiCard title={mode === 'operational' ? 'לחלוקה (להשוואה)' : 'תפעולי (להשוואה)'} value={other.profit} nature="locked" division={division}
            subtitle={`הפרש ${Math.round(totals.profit - other.profit).toLocaleString('he-IL')} ₪`}
            drill={<p className="text-sm text-text-2">{mode === 'operational' ? 'רווח לחלוקה: רק הוצאות מוכרות (ובמימון: מאושרות), ישירות לפי חודש התיק.' : 'רווח תפעולי: כל ההוצאות, כולל לא-מוכרות ולא-מאושרות — מה שנשאר בקופה.'}</p>} />
        </div>

        <PnlTables income={income} expenses={expenses} byMonth={byMonth} currentMonth={period} />
        <MonthCloseChecklist month={period} />
      </main>
    </>
  )
}
