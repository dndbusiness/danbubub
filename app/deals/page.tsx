import { Briefcase, Plus } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { listFinanceDeals, listRealEstateDeals } from '@/lib/queries/deals'
import { activeAlertCount, isPeriodLocked, listAccounts, listCategories, vatRateOn } from '@/lib/queries/common'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { DealsTable } from './table'
import { NewDealForm } from './new-deal'
import { RealEstateDeals } from './realestate'

export const dynamic = 'force-dynamic'

/**
 * מסך 4 — תיקים. SPEC §5, UIUX §5.2.
 *   מימון  → פייפליין תפעולי: שלבים, גביה, צ'קליסט ביצוע.
 *   נדל"ן  → כסף בלבד (הבהרת דן 18/09/2026): לקוח, סכום, 2% שכ"ט, 1% עמלת יזם,
 *            הוצאות ישירות, פוטנציאל/סגור. בלי שלבים ובלי צ'קליסט.
 */
export default async function DealsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const tab = typeof sp.tab === 'string' ? sp.tab : 'all'

  if (division === 'realestate') {
    const [reDeals, alerts, locked, categories, accounts, vatRate] = await Promise.all([
      listRealEstateDeals(), activeAlertCount(), isPeriodLocked(period, 'realestate'), listCategories(), listAccounts(), vatRateOn(now.slice(0, 10)),
    ])
    const closed = reDeals.filter((d) => d.closed)
    const potential = reDeals.filter((d) => !d.closed)
    const sumOf = (list: typeof reDeals, f: (d: (typeof reDeals)[number]) => number) => list.reduce((a, d) => a + f(d), 0)
    const drillRe = (list: typeof reDeals, f: (d: (typeof reDeals)[number]) => number) => (
      <ul className="divide-y divide-border text-sm">{list.map((d) => <li key={d.deal_id} className="flex justify-between py-2"><span>{d.client_name}</span><Money value={f(d)} /></li>)}</ul>
    )
    return (
      <>
        <Topbar period={period} division="realestate" periodLocked={locked} alertCount={alerts} />
        <main className="p-4 md:p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Briefcase size={20} className="text-div-realestate" />
            <h1 className="text-xl font-semibold">עסקאות — נדל״ן</h1>
            <span className="text-xs text-text-3">כסף בלבד · {closed.length} סגורות · {potential.length} פוטנציאל</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <KpiCard title="שכ״ט סגור" value={sumOf(closed, (d) => d.fee_agreed_net)} certainty="committed" division="realestate" drill={drillRe(closed, (d) => d.fee_agreed_net)} />
            <KpiCard title="עמלות יזם סגורות" value={sumOf(closed, (d) => d.developer_commission_net ?? 0)} certainty="committed" division="realestate" drill={drillRe(closed, (d) => d.developer_commission_net ?? 0)} />
            <KpiCard title="פוטנציאל (שכ״ט + יזם)" value={sumOf(potential, (d) => d.fee_agreed_net + (d.developer_commission_net ?? 0))} certainty="expected" division="realestate" drill={drillRe(potential, (d) => d.fee_agreed_net + (d.developer_commission_net ?? 0))} />
            <KpiCard title="נגבה" value={sumOf(reDeals, (d) => d.collected_net)} certainty="actual" division="realestate" drill={drillRe(reDeals, (d) => d.collected_net)} />
            <KpiCard title="הוצאות ישירות" value={sumOf(reDeals, (d) => d.direct_costs_net)} nature="open" division="realestate" drill={drillRe(reDeals, (d) => d.direct_costs_net)} />
            <KpiCard title="תרומה נטו" value={sumOf(reDeals, (d) => d.net_contribution)} division="realestate" drill={drillRe(reDeals, (d) => d.net_contribution)} />
          </div>
          <RealEstateDeals deals={reDeals} categories={categories} accounts={accounts} vatRate={vatRate} />
        </main>
      </>
    )
  }

  const [deals, alerts, locked] = await Promise.all([listFinanceDeals(), activeAlertCount(), isPeriodLocked(period, 'finance')])

  const open = deals.filter((d) => d.status === 'open' || d.status === 'won')
  const sum = (f: (d: (typeof deals)[number]) => number, list = open) => list.reduce((a, d) => a + f(d), 0)

  const drill = (list: typeof deals, pick: (d: (typeof deals)[number]) => number) => (
    <ul className="divide-y divide-border text-sm">
      {list.filter((d) => pick(d) !== 0).map((d) => (
        <li key={d.deal_id} className="flex justify-between py-2">
          <span>{d.client_name}</span>
          <Money value={pick(d)} />
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <Topbar period={period} division="finance" periodLocked={locked} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Briefcase size={20} className="text-div-finance" />
          <h1 className="text-xl font-semibold">תיקים — מימון</h1>
          <span className="text-xs text-text-3">{deals.length} תיקים</span>
          <div className="ms-auto">
            <NewDealForm trigger={<Button variant="primary"><Plus size={16} /> תיק חדש</Button>} />
          </div>
        </div>

        {/* UIUX §5.2 KPI — 6 כרטיסים, כל אחד עם drill-down */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KpiCard title="שכ״ט נסגר" value={sum((d) => d.fee_agreed_net)} division="finance" drill={drill(open, (d) => d.fee_agreed_net)} />
          <KpiCard title="נגבה" value={sum((d) => d.collected_net)} certainty="actual" division="finance" drill={drill(open, (d) => d.collected_net)} />
          <KpiCard title="פתוח ודאי" value={sum((d) => d.open_committed)} certainty="committed" division="finance" drill={drill(open, (d) => d.open_committed)} />
          <KpiCard title="פתוח פוטנציאלי" value={sum((d) => d.open_expected_weighted)} certainty="expected" division="finance" drill={drill(open, (d) => d.open_expected_weighted)} />
          <KpiCard title="הוצאות ישירות" value={sum((d) => d.direct_costs_net)} nature="open" division="finance" drill={drill(open, (d) => d.direct_costs_net)} />
          <KpiCard title="תרומה נטו" value={sum((d) => d.net_contribution)} division="finance" drill={drill(open, (d) => d.net_contribution)} />
        </div>

        <DealsTable deals={deals} tab={tab} />
      </main>
    </>
  )
}
