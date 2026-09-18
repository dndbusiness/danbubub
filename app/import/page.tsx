import Link from 'next/link'
import { FileUp, Sparkles } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { KpiCard } from '@/components/kpi-card'
import { Card } from '@/components/ui/card'
import { DEFAULT_COLUMN_MAPS } from '@/lib/import/credit-card'
import { activeAlertCount } from '@/lib/queries/common'
import { automationRate, listBatches, listCardAccounts, listEntities, listRuleRows } from '@/lib/queries/imports'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { formatPct } from '@/lib/ui/format'
import { UploadCard } from './upload'
import { BatchesTable } from './batches'
import { RulesTable } from './rules'

export const dynamic = 'force-dynamic'

/**
 * מסך 11 — ייבוא (אשראי בלבד בשלב 4; בנק / חשבונית ירוקה / WISE בשלבים 6, 8).
 * SPEC §4.1 + §4.4, UIUX §5.5. קריטריון §9: 80%+ סיווג אוטומטי אחרי חודש.
 */
export default async function ImportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const [batches, accounts, entities, rules, auto, alerts] = await Promise.all([
    listBatches(), listCardAccounts(), listEntities(), listRuleRows(), automationRate(), activeAlertCount(),
  ])
  const pendingBatches = batches.filter((b) => b.status === 'review')

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <FileUp size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">ייבוא</h1>
          <span className="text-xs text-text-3">כרטיסי אשראי · בנק וחשבונית ירוקה בשלב 6 · WISE בשלב 8</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            title="סיווג אוטומטי" value={Math.round(auto.rate * 100)} count certainty={auto.rate >= 0.8 ? 'actual' : undefined} nature={auto.rate >= 0.8 ? undefined : 'open'}
            subtitle={`${auto.auto} מתוך ${auto.total} שורות אשראי סווגו לפי כלל · יעד 80% (SPEC §9 שלב 4) — ${formatPct(auto.rate)}`}
            drillTitle="הכללים הפעילים"
            drill={<RulesTable rows={rules} />}
          />
          <KpiCard title="ממתין לאישור" value={pendingBatches.length} count nature={pendingBatches.length ? 'open' : undefined}
            subtitle="אצוות שהועלו ולא הוחלו" drillTitle="אצוות ממתינות"
            drill={<ul className="divide-y divide-border text-sm">{pendingBatches.map((b) => <li key={b.id} className="py-2"><Link href={`/import/${b.id}`} className="underline">{b.file_name}</Link></li>)}{!pendingBatches.length && <li className="py-2 text-text-3">אין</li>}</ul>}
          />
          <KpiCard title="כללים פעילים" value={rules.length} count subtitle={`תפסו ${rules.reduce((a, r) => a + r.hit_count, 0)} שורות בסך הכל`} drillTitle="כללים" drill={<RulesTable rows={rules} />} />
        </div>

        <UploadCard accounts={accounts} entities={entities} formats={DEFAULT_COLUMN_MAPS.map((m) => ({ id: m.id, label: m.label }))} />

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">אצוות שיובאו</h2>
          <BatchesTable rows={batches} />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-text-2" />
            <h2 className="font-semibold">כללים לומדים</h2>
            <span className="text-xs text-text-3">SPEC §4.4 — כל סיווג ידני מציע "להפוך לכלל?"</span>
          </div>
          <Card><RulesTable rows={rules} /></Card>
        </section>
      </main>
    </>
  )
}
