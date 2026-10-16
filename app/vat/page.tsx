import { Percent } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { activeAlertCount } from '@/lib/queries/common'
import { nextVatPayment, vatPeriods } from '@/lib/queries/vat'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { formatMoney } from '@/lib/ui/format'
import { VatHeader, VatView } from './client'

export const dynamic = 'force-dynamic'

/** מסך 10 — מע"מ (SPEC §3.1): חבות בכל רגע, לפי תקופת דיווח, ותשומות ללא חשבונית. */
export default async function VatPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const [rows, next, alerts] = await Promise.all([vatPeriods(), nextVatPayment(now.slice(0, 10)), activeAlertCount()])
  const current = rows.find((r) => r.period === period || r.period.startsWith(period.slice(0, 5))) ?? rows[0]
  const missingTotal = rows.reduce((a, r) => a + r.input_vat_missing_invoice, 0)
  const missingCount = rows.reduce((a, r) => a + r.missing_invoice_count, 0)

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Percent size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">מע״מ</h1>
          <span className="text-xs text-text-3">חבות = מע״מ עסקאות פחות תשומות שיש להן חשבונית (§3.1)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard title={`חבות ${current?.period ?? ''}`} value={current?.liability ?? 0} certainty="committed" nature={(current?.liability ?? 0) > 0 ? 'open' : undefined}
            subtitle={current ? `עסקאות ${formatMoney(current.output_vat)} · תשומות ${formatMoney(current.input_vat_claimable)}` : '—'}
            drillTitle="החבות מורכבת מ" drill={<p className="text-sm">לחצו על המספרים בטבלה כדי לראות את השורות.</p>} />
          <KpiCard title="תשומות ללא חשבונית — 18 חודשים" value={missingTotal} nature="open" count={false}
            subtitle={`${missingCount} הוצאות · זה הכסף שמפסידים אם לא משיגים אותן`}
            drillTitle="לפי תקופה" drill={<ul className="divide-y divide-border text-sm">{rows.filter((r) => r.missing_invoice_count > 0).map((r) => <li key={r.period} className="flex justify-between py-2"><span>{r.period} · {r.missing_invoice_count} הוצאות</span><Money value={r.input_vat_missing_invoice} nature="open" /></li>)}</ul>} />
          <KpiCard title="תקופות במערכת" value={rows.length} count subtitle="לפי חודש המסמך (או חודש הדיווח מחשבונית ירוקה)"
            drillTitle="תקופות" drill={<ul className="divide-y divide-border text-sm">{rows.map((r) => <li key={r.period} className="flex justify-between py-2"><span>{r.period}</span><Money value={r.liability} /></li>)}</ul>} />
        </div>

        <VatHeader next={next} bimonthly={Boolean(rows[0]?.bimonthly)} />
        <VatView rows={rows} />
      </main>
    </>
  )
}
