import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, Phone } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { Card } from '@/components/ui/card'
import { Money } from '@/components/money'
import { CollectionPill, StatusPill } from '@/components/status-pill'
import { getDeal } from '@/lib/queries/deals'
import { activeAlertCount, listAccounts, listCategories, vatRateOn } from '@/lib/queries/common'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { FINANCE_STAGE_LABELS, PRODUCT_LABELS, formatDate } from '@/lib/ui/format'
import { DealTabs } from './tabs'

export const dynamic = 'force-dynamic'

/** כרטיס תיק — UIUX §5.2: ראש, 4 מספרים, טאבים, פיד פעילות. */
export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period } = readGlobalParams(sp, now)
  const data = await getDeal(id)
  if (!data) notFound()
  const { deal, payments, txs, checklist, activity } = data
  const [alerts, categories, accounts, vatRate] = await Promise.all([activeAlertCount(), listCategories(), listAccounts(), vatRateOn(now.slice(0, 10))])

  return (
    <>
      <Topbar period={period} division="finance" alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <Link href="/deals" className="text-xs text-text-2 inline-flex items-center gap-1 hover:underline"><ChevronRight size={14} /> תיקים</Link>

        <Card division="finance" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">{deal.client_name}</h1>
            {deal.client_phone && (
              <a href={`https://wa.me/${deal.client_phone.replace(/\D/g, '').replace(/^0/, '972')}`} className="text-xs text-text-2 inline-flex items-center gap-1 hover:underline" dir="ltr">
                <Phone size={12} /> {deal.client_phone}
              </a>
            )}
            <span className="text-sm text-text-2">{PRODUCT_LABELS[deal.product] ?? deal.product}</span>
            <StatusPill tone={deal.stage === 'completed' ? 'actual' : 'committed'}>{FINANCE_STAGE_LABELS[deal.stage] ?? deal.stage}</StatusPill>
            <CollectionPill status={deal.collection_status} />
            {deal.owner_name && <span className="text-xs text-text-3">אחראי: {deal.owner_name}</span>}
            {deal.month_attributed && <span className="text-xs text-text-3">חודש התחשבנות {deal.month_attributed.slice(5)}/{deal.month_attributed.slice(0, 4)}</span>}
            {deal.next_missing && <span className="ms-auto text-xs text-expected">הבא שחסר: {deal.next_missing}</span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-border">
            <Stat label="שכ״ט"><Money value={deal.fee_agreed_net} size="lg" /></Stat>
            <Stat label="נגבה"><Money value={deal.collected_net} size="lg" certainty="actual" /></Stat>
            <Stat label="פתוח"><Money value={deal.open_balance_net} size="lg" nature={deal.open_balance_net > 0 ? 'open' : 'neutral'} /></Stat>
            <Stat label="תרומה נטו"><Money value={deal.net_contribution} size="lg" /></Stat>
          </div>
          {deal.signed_at && <div className="text-xs text-text-3">נחתם {formatDate(deal.signed_at)}</div>}
        </Card>

        <DealTabs deal={deal} payments={payments} txs={txs} checklist={checklist} activity={activity} categories={categories} accounts={accounts} vatRate={vatRate} />
      </main>
    </>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-xs text-text-2">{label}</span>{children}</div>
}
