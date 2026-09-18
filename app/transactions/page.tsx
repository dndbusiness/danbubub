import { Plus, Receipt } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { listTransactions, monthSummary } from '@/lib/queries/transactions'
import { activeAlertCount, isPeriodLocked, listAccounts, listCategories, vatRateOn } from '@/lib/queries/common'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { formatMonth } from '@/lib/ui/format'
import { TransactionsTable } from './table'
import { NewTransactionForm } from './new-transaction'

export const dynamic = 'force-dynamic'

/** מסך 5 — תנועות. SPEC §5: כל התנועות, פילטרים, עריכה, סיווג, "לשאול את…". */
export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const [rows, summary, alerts, categories, accounts, vatRate, lockedFin, lockedRe] = await Promise.all([
    listTransactions({ month: period, division }),
    monthSummary(period, division),
    activeAlertCount(),
    listCategories(),
    listAccounts(),
    vatRateOn(now.slice(0, 10)),
    isPeriodLocked(period, 'finance'),
    isPeriodLocked(period, 'realestate'),
  ])
  const locked = division === 'realestate' ? lockedRe : division === 'finance' ? lockedFin : lockedFin && lockedRe

  const list = (pick: (r: (typeof rows)[number]) => boolean) => (
    <ul className="divide-y divide-border text-sm">
      {rows.filter(pick).map((r) => (
        <li key={r.id} className="flex justify-between gap-3 py-2">
          <span className="truncate">{r.description ?? r.counterparty ?? r.category_name ?? '—'}</span>
          <Money value={r.amount_net} certainty="actual" />
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <Topbar period={period} division={division} periodLocked={locked} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Receipt size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">תנועות — {formatMonth(period)}</h1>
          <span className="text-xs text-text-3">{rows.length} שורות</span>
          <div className="ms-auto">
            <NewTransactionForm categories={categories} accounts={accounts} vatRate={vatRate} trigger={<Button variant="primary"><Plus size={16} /> תנועה חדשה</Button>}
              defaults={sp.quick === 'new' ? { open: true, amount: Number(sp.amount) || undefined, date: typeof sp.date === 'string' ? sp.date : undefined, dailyCloseId: typeof sp.close === 'string' ? sp.close : undefined } : undefined} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KpiCard title="הכנסות" value={summary.income} certainty="actual" drill={list((r) => r.nature === 'income')} />
          <KpiCard title="הוצאות" value={summary.expense} nature="open" drill={list((r) => r.nature === 'expense')} />
          <KpiCard title="מקדמות לניסים" value={summary.advance} drill={list((r) => r.nature === 'advance')} />
          <KpiCard title="משיכות שותפים" value={summary.draw} drill={list((r) => r.nature === 'draw')} />
          <KpiCard title="לא מזוהות" value={summary.unknownCount} nature={summary.unknownCount ? 'open' : 'locked'} count subtitle="תנועות" drill={list((r) => r.review_status === 'unknown_expense')} />
          <KpiCard title="מע״מ ללא חשבונית" value={summary.missingInvoiceVat} nature={summary.missingInvoiceVat ? 'open' : 'locked'} subtitle={`${summary.missingInvoiceCount} הוצאות`} drill={list((r) => r.nature === 'expense' && (r.invoice_status === 'missing' || r.invoice_status === 'unknown'))} />
        </div>

        <TransactionsTable rows={rows} categories={categories} />
      </main>
    </>
  )
}
