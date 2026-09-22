'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Gauge, RotateCcw, Sliders, TrendingUp } from 'lucide-react'
import { DataTable, type Column } from '@/components/data-table'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/status-pill'
import type { ForecastBundle } from '@/lib/queries/forecast'
import type { ForecastAssumption, Scenario } from '@/lib/rules/forecast'
import { formatMoney, formatMonth, formatPct } from '@/lib/ui/format'
import { withHebrewProducts } from '@/lib/ui/labels'
import { cn } from '@/lib/ui/cn'

const SCENARIO_LABEL: Record<Scenario, string> = { pessimistic: 'פסימי', base: 'בסיס', optimistic: 'אופטימי' }
const SCENARIOS: Scenario[] = ['pessimistic', 'base', 'optimistic']

/** מסך 13 — §3.7. שלושה טאבים, שלושה תרחישים, והנחות שאפשר לדרוס. */
export function ForecastView({ bundle, reScenario, finScenario, overrides }: {
  bundle: ForecastBundle
  reScenario: Scenario
  finScenario: Scenario
  overrides: Record<string, number>
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [tab, setTab] = React.useState<'unified' | 'realestate' | 'finance'>('unified')

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v)
    router.push(`/forecast?${next.toString()}`)
  }

  const re = bundle.realEstate.filter((m) => m.scenario === reScenario)
  const fin = bundle.finance.filter((m) => m.scenario === finScenario)
  const unified = bundle.unified

  const lowest = unified.reduce<{ month: string; balance: number } | null>(
    (acc, m) => (!acc || m.expectedClosingBalance < acc.balance ? { month: m.month, balance: m.expectedClosingBalance } : acc), null)
  const totalCollections = fin.reduce((a, m) => a + m.totalCollections, 0) + re.reduce((a, m) => a + m.totalIncome, 0)
  const totalProfit = fin.reduce((a, m) => a + m.distributableProfit, 0) + re.reduce((a, m) => a + m.distributableProfit, 0)
  const closing = unified.at(-1)?.expectedClosingBalance ?? bundle.openingBalance

  // כל ההנחות של החודש הראשון — הן זהות לאורך התחזית.
  const assumptions: ForecastAssumption[] = [...(re[0]?.assumptions ?? []), ...(fin[0]?.assumptions ?? [])]

  const unifiedColumns: Column<(typeof unified)[number] & { id: string }>[] = [
    { key: 'month', header: 'חודש', cell: (m) => formatMonth(m.month) },
    { key: 'openingBalance', header: 'פתיחה', align: 'end', value: (m) => m.openingBalance, cell: (m) => <Money value={m.openingBalance} /> },
    { key: 'realEstateNet', header: 'נדל״ן נטו', align: 'end', value: (m) => m.realEstateNet, cell: (m) => <Money value={m.realEstateNet} certainty="expected" /> },
    { key: 'financeNet', header: 'מימון נטו', align: 'end', value: (m) => m.financeNet, cell: (m) => <Money value={m.financeNet} certainty="expected" /> },
    { key: 'vat', header: 'מע״מ', align: 'end', value: (m) => -m.vat, cell: (m) => <Money value={-m.vat} nature={m.vat ? 'open' : undefined} /> },
    { key: 'expectedClosingBalance', header: 'סגירה צפויה', align: 'end', value: (m) => m.expectedClosingBalance, cell: (m) => <Money value={m.expectedClosingBalance} nature={m.expectedClosingBalance < 0 ? 'open' : undefined} certainty="expected" /> },
  ]

  const reColumns: Column<(typeof re)[number] & { id: string }>[] = [
    { key: 'month', header: 'חודש', cell: (m) => formatMonth(m.month) },
    { key: 'expectedDeals', header: 'עסקאות צפויות', align: 'end', value: (m) => m.expectedDeals, cell: (m) => <span className="tnum">{m.expectedDeals.toFixed(1)}</span> },
    { key: 'immediateIncome', header: 'שכ״ט בחתימה', align: 'end', value: (m) => m.immediateIncome, cell: (m) => <Money value={m.immediateIncome} certainty="expected" /> },
    { key: 'developerCommissions', header: 'עמלת יזם (שוטף+30)', align: 'end', value: (m) => m.developerCommissions, cell: (m) => <Money value={m.developerCommissions} certainty="expected" />, mobileHidden: true },
    { key: 'pipelineIncome', header: 'מהפייפליין', align: 'end', value: (m) => m.pipelineIncome, cell: (m) => <Money value={m.pipelineIncome} certainty="committed" /> },
    { key: 'expenses', header: 'הוצאות', align: 'end', value: (m) => -m.expenses, cell: (m) => <Money value={-m.expenses} /> },
    { key: 'distributableProfit', header: 'רווח לחלוקה', align: 'end', value: (m) => m.distributableProfit, cell: (m) => <Money value={m.distributableProfit} certainty="expected" /> },
    { key: 'partnerShares', header: 'לכל שותף', align: 'end', value: (m) => m.partnerShares[0] ?? 0, cell: (m) => <span className="tnum text-xs">{formatMoney(m.partnerShares[0] ?? 0)}</span>, mobileHidden: true },
    { key: 'netCashFlow', header: 'תזרים נטו', align: 'end', value: (m) => m.netCashFlow, cell: (m) => <Money value={m.netCashFlow} nature={m.netCashFlow < 0 ? 'open' : undefined} /> },
  ]

  const finColumns: Column<(typeof fin)[number] & { id: string }>[] = [
    { key: 'month', header: 'חודש', cell: (m) => formatMonth(m.month) },
    { key: 'expectedSignings', header: 'חתימות צפויות', align: 'end', value: (m) => m.expectedSignings, cell: (m) => <span className="tnum">{m.expectedSignings.toFixed(1)}</span> },
    { key: 'signingAdvances', header: 'מקדמות', align: 'end', value: (m) => m.signingAdvances, cell: (m) => <Money value={m.signingAdvances} certainty="expected" />, mobileHidden: true },
    { key: 'pipelineCollections', header: 'מהפייפליין', align: 'end', value: (m) => m.pipelineCollections, cell: (m) => <Money value={m.pipelineCollections} certainty="committed" /> },
    { key: 'newBusinessCollections', header: 'מעסקים חדשים', align: 'end', value: (m) => m.newBusinessCollections, cell: (m) => <Money value={m.newBusinessCollections} certainty="expected" /> },
    { key: 'totalCollections', header: 'סה״כ גביה', align: 'end', value: (m) => m.totalCollections, cell: (m) => <Money value={m.totalCollections} certainty="expected" /> },
    { key: 'distributableProfit', header: 'רווח לחלוקה', align: 'end', value: (m) => m.distributableProfit, cell: (m) => <Money value={m.distributableProfit} certainty="expected" /> },
    { key: 'nissimExpectedBalance', header: 'יתרת ניסים צפויה', align: 'end', value: (m) => m.nissimExpectedBalance, cell: (m) => <Money value={m.nissimExpectedBalance} />, mobileHidden: true },
    { key: 'netCashFlow', header: 'תזרים נטו', align: 'end', value: (m) => m.netCashFlow, cell: (m) => <Money value={m.netCashFlow} nature={m.netCashFlow < 0 ? 'open' : undefined} /> },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* בסיס הנתונים — §UIUX 1.3: להגיד על מה זה נשען, ולא להעמיד פנים */}
      <Card className="flex flex-wrap items-center gap-3 text-sm">
        <Gauge size={16} className="text-text-2" />
        <span className="text-text-2">
          מבוסס על {bundle.sample.deals} תיקים · {bundle.sample.plans} תקבולים מתוכננים · {bundle.sample.months} חודשי היסטוריה
        </span>
        {bundle.anchorDate
          ? <span className="text-xs text-text-3">נקודת הפתיחה: העוגן מ-{bundle.anchorDate} ({formatMoney(bundle.openingBalance)})</span>
          : <span className="text-xs text-open">אין עוגן — התחזית מתחילה מ-0 ולא מיתרה אמיתית</span>}
        {bundle.sample.months < 6 && (
          <span className="text-xs text-expected">פחות מ-6 חודשי היסטוריה — הקצב הנמדד עדיין רועד</span>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="גביה צפויה — רבעון" value={totalCollections} certainty="expected"
          subtitle={`${SCENARIO_LABEL[reScenario]} בנדל״ן · ${SCENARIO_LABEL[finScenario]} במימון`}
          drillTitle="לפי חודש" drill={<MonthList rows={unified.map((m) => ({ month: m.month, amount: m.realEstateNet + m.financeNet }))} />} />
        <KpiCard title="רווח לחלוקה צפוי" value={totalProfit} certainty="expected"
          subtitle="שתי הפעילויות יחד, לפי הגדרת החלוקה"
          drillTitle="לפי חודש" drill={<MonthList rows={[...re, ...fin].map((m) => ({ month: m.month, amount: m.distributableProfit }))} />} />
        <KpiCard title="יתרה בסוף הרבעון" value={closing} certainty="expected" nature={closing < 0 ? 'open' : undefined}
          subtitle={`מהעוגן ${formatMoney(bundle.openingBalance)}`}
          drillTitle="מסלול היתרה" drill={<MonthList rows={unified.map((m) => ({ month: m.month, amount: m.expectedClosingBalance }))} />} />
        <KpiCard title="הנקודה הנמוכה" value={lowest?.balance ?? 0} nature={(lowest?.balance ?? 0) < 0 ? 'open' : undefined}
          subtitle={lowest ? `בחודש ${formatMonth(lowest.month)}` : 'אין נתונים'}
          drillTitle="מסלול היתרה" drill={<MonthList rows={unified.map((m) => ({ month: m.month, amount: m.expectedClosingBalance }))} />} />
      </div>

      {/* שני התרחישים נבחרים בנפרד — §3.7.3: "אפשר לשלב נדל"ן פסימי + מימון בסיס" */}
      <Card className="flex flex-wrap items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-2">
          <span className="text-text-2">נדל״ן</span>
          {SCENARIOS.map((s) => (
            <button key={s} type="button" onClick={() => setParam({ re: s })}
              className={cn('px-2 py-1 rounded-[var(--radius-btn)] border border-border text-xs', s === reScenario && 'bg-locked-bg font-medium')}>
              {SCENARIO_LABEL[s]}
            </button>
          ))}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-text-2">מימון</span>
          {SCENARIOS.map((s) => (
            <button key={s} type="button" onClick={() => setParam({ fin: s })}
              className={cn('px-2 py-1 rounded-[var(--radius-btn)] border border-border text-xs', s === finScenario && 'bg-locked-bg font-medium')}>
              {SCENARIO_LABEL[s]}
            </button>
          ))}
        </span>
        {Object.keys(overrides).length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setParam(Object.fromEntries(Object.keys(overrides).map((k) => [`o.${k}`, null])))}>
            <RotateCcw size={14} /> נקה {Object.keys(overrides).length} דריסות
          </Button>
        )}
      </Card>

      <div className="flex gap-1 border-b border-border">
        {([['unified', 'מאוחד'], ['realestate', 'נדל״ן'], ['finance', 'מימון']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn('px-3 py-2 text-sm -mb-px border-b-2', tab === k ? 'border-brand text-text font-medium' : 'border-transparent text-text-2')}>{l}</button>
        ))}
      </div>

      {tab === 'unified' && (
        <DataTable rows={unified.map((m) => ({ ...m, id: m.month }))} columns={unifiedColumns} exportName="forecast-unified"
          primaryKeys={['month', 'expectedClosingBalance']} emptyState="אין מספיק נתונים לתחזית" />
      )}
      {tab === 'realestate' && (
        <DataTable rows={re.map((m) => ({ ...m, id: m.month }))} columns={reColumns} exportName="forecast-realestate"
          primaryKeys={['month', 'distributableProfit', 'netCashFlow']} emptyState="אין מספיק נתוני נדל״ן לתחזית" />
      )}
      {tab === 'finance' && (
        <DataTable rows={fin.map((m) => ({ ...m, id: m.month }))} columns={finColumns} exportName="forecast-finance"
          primaryKeys={['month', 'totalCollections', 'netCashFlow']} emptyState="אין מספיק נתוני מימון לתחזית" />
      )}

      {/* הנחות — §3.7.3: "ההנחות ניתנות לדריסה", וכל אחת אומרת על כמה היא נשענת */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Sliders size={16} className="text-text-2" />
          <h2 className="font-semibold">ההנחות שמאחורי המספרים</h2>
          <span className="text-xs text-text-3">אפשר לדרוס כל אחת ולראות מה זה עושה — הדריסה נשמרת בכתובת ואפשר לשתף אותה</span>
        </div>
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-xs text-text-2 bg-locked-bg">
              <tr><th className="text-start p-2">הנחה</th><th className="text-end p-2">ערך</th><th className="text-end p-2">נמדד על</th><th className="text-start p-2">דריסה</th></tr>
            </thead>
            <tbody>
              {assumptions.map((a) => (
                <tr key={a.key} className="border-t border-border">
                  <td className="p-2">
                    {withHebrewProducts(a.label)}
                    {a.overridden && <StatusPill tone="expected" className="ms-2">נדרס</StatusPill>}
                  </td>
                  <td className="p-2 text-end tnum">
                    {a.unit === 'shekels' ? formatMoney(a.value) : a.unit === 'pct' ? formatPct(a.value, 1) : a.value.toFixed(2)}
                    <span className="text-xs text-text-3"> {a.unit === 'deals' ? 'עסקאות' : a.unit === 'weeks' ? 'שבועות' : a.unit === 'months' ? 'חודשים' : ''}</span>
                  </td>
                  <td className="p-2 text-end">
                    {a.sampleSize === 0
                      ? <span className="text-open text-xs">אין נתונים</span>
                      : <span className="text-xs text-text-3 tnum">{a.sampleSize}</span>}
                  </td>
                  <td className="p-2">
                    <form className="flex gap-1" action={(fd) => {
                      const v = String(fd.get('v') ?? '').trim()
                      setParam({ [`o.${a.key}`]: v === '' ? null : v })
                    }}>
                      <input name="v" inputMode="decimal" defaultValue={overrides[a.key] ?? ''} placeholder="—"
                        className="h-8 w-24 rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-xs" />
                      <Button size="sm" variant="ghost" type="submit">החל</Button>
                    </form>
                  </td>
                </tr>
              ))}
              {!assumptions.length && <tr><td colSpan={4} className="p-4 text-center text-text-3">אין הנחות להציג — חסרים נתוני בסיס</td></tr>}
            </tbody>
          </table>
        </Card>
      </section>

      {/* §3.7.3 — דיוק היסטורי */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-text-2" />
          <h2 className="font-semibold">כמה לסמוך על התחזית</h2>
          <span className="text-xs text-text-3">מה חזינו 30/60/90 יום מראש מול מה שקרה בפועל</span>
        </div>
        {bundle.accuracy.length ? (
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="text-xs text-text-2 bg-locked-bg">
                <tr><th className="text-start p-2">חודש</th><th className="text-start p-2">אופק</th><th className="text-end p-2">נחזה</th><th className="text-end p-2">בפועל</th><th className="text-end p-2">דיוק</th></tr>
              </thead>
              <tbody>
                {bundle.accuracy.map((a, i) => (
                  <tr key={`${a.targetMonth}:${a.horizonDays}:${a.division}:${i}`} className="border-t border-border">
                    <td className="p-2">{formatMonth(a.targetMonth)}</td>
                    <td className="p-2 text-text-2">{a.horizonDays} יום · {a.division === 'unified' ? 'מאוחד' : a.division === 'finance' ? 'מימון' : 'נדל״ן'}</td>
                    <td className="p-2 text-end"><Money value={a.predicted} certainty="expected" /></td>
                    <td className="p-2 text-end"><Money value={a.actual} certainty="actual" /></td>
                    <td className="p-2 text-end">
                      {a.accuracyPct === null ? <span className="text-text-3">—</span> : (
                        <StatusPill tone={a.accuracyPct >= 85 ? 'actual' : a.accuracyPct >= 60 ? 'expected' : 'open'}>{a.accuracyPct.toFixed(0)}%</StatusPill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card className="text-sm text-text-2">
            עדיין אין תצלומי תחזית להשוות מולם. כל חודש שנסגר שומר מה נחזה 30/60/90 יום קודם,
            והמספר הזה יופיע כאן אחרי הסגירה הראשונה (§3.7.3).
          </Card>
        )}
      </section>
    </div>
  )
}

function MonthList({ rows }: { rows: { month: string; amount: number }[] }) {
  if (!rows.length) return <p className="text-sm text-text-3">אין נתונים</p>
  const byMonth = new Map<string, number>()
  for (const r of rows) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.amount)
  return (
    <ul className="divide-y divide-border text-sm">
      {[...byMonth.entries()].sort().map(([month, amount]) => (
        <li key={month} className="flex justify-between py-2">
          <span>{formatMonth(month)}</span>
          <Money value={amount} certainty="expected" />
        </li>
      ))}
    </ul>
  )
}
