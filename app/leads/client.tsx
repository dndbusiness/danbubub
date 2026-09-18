'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Building2, Coins, Plus, Trash2 } from 'lucide-react'
import { addLeadCost, addLeadSource, deleteLeadCost, setLeadSource } from '@/app/actions/leads'
import { ActionDrawerForm } from '@/components/forms/action-form'
import { DataTable, type Column } from '@/components/data-table'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { StatusPill } from '@/components/status-pill'
import type { ChannelFlag } from '@/lib/rules/conversion'
import type { ConversionViewRow, FunnelStage, LeadRow, SourceSummary } from '@/lib/queries/leads'
import { formatDate, formatMoney, formatPct } from '@/lib/ui/format'
import { PRODUCT_LABEL } from '@/lib/ui/labels'
import { cn } from '@/lib/ui/cn'

const STAGE_LABEL: Record<string, string> = {
  received: 'התקבל', contacted: 'נוצר קשר', meeting: 'פגישה',
  proposal: 'הצעה', signed: 'חתם', closed_won: 'נגבה', closed_lost: 'אבוד',
}
const selectClass = 'h-8 rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-xs max-w-[150px]'

export function LeadsView({ weeks, stages, sources, grid, leads, costs, allSources, submissions, flags }: {
  weeks: ConversionViewRow[]
  stages: FunnelStage[]
  sources: SourceSummary[]
  grid: { source_name: string; product: string; leads: number; signings: number; revenue: number }[]
  leads: LeadRow[]
  costs: { id: string; date: string; source_name: string; amount: number; note: string | null }[]
  allSources: { id: string; name: string; cost_model: string; unit_cost: number | null }[]
  submissions: { total: number; approved: number; banks: { bank: string; n: number; approved: number }[] }
  flags: (ChannelFlag & { sourceName: string })[]
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<'weekly' | 'sources' | 'leads' | 'costs'>('weekly')

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => { const r = await fn(); if (!r.ok) { setError(r.error); return } setError(null); router.refresh() })

  const totalLeads = stages[0]?.count ?? 0
  const totalCost = Math.abs(stages[0]?.amount ?? 0)
  const signed = stages.find((s) => s.stage === 'signed')
  const collected = stages.find((s) => s.stage === 'collected')
  const cac = signed?.count ? Math.round((totalCost / signed.count) * 100) / 100 : null
  const roi = totalCost > 0 ? Math.round(((collected?.amount ?? 0) / totalCost) * 100) / 100 : null
  const maxCount = Math.max(1, ...stages.map((s) => s.count))

  const weeklyColumns: Column<ConversionViewRow & { id: string }>[] = [
    { key: 'week', header: 'שבוע', cell: (r) => formatDate(r.week) },
    { key: 'source_name', header: 'ערוץ' },
    { key: 'product', header: 'מוצר', cell: (r) => <span className="text-xs">{PRODUCT_LABEL[r.product] ?? r.product}</span>, mobileHidden: true },
    { key: 'leads', header: 'לידים', align: 'end', value: (r) => Number(r.leads), footer: <span className="tnum">{weeks.reduce((a, r) => a + Number(r.leads), 0)}</span> },
    { key: 'signings', header: 'חתמו', align: 'end', value: (r) => Number(r.signings), footer: <span className="tnum">{weeks.reduce((a, r) => a + Number(r.signings), 0)}</span> },
    { key: 'conversion_to_signing', header: 'המרה לחתימה', align: 'end', value: (r) => Number(r.conversion_to_signing ?? 0), cell: (r) => r.conversion_to_signing === null ? <span className="text-text-3">—</span> : <span className="tnum">{formatPct(Number(r.conversion_to_signing), 1)}</span> },
    { key: 'lead_cost', header: 'עלות', align: 'end', value: (r) => Number(r.lead_cost), cell: (r) => <Money value={-Number(r.lead_cost)} />, footer: <Money value={-weeks.reduce((a, r) => a + Number(r.lead_cost), 0)} /> },
    { key: 'cac', header: 'CAC', align: 'end', value: (r) => Number(r.cac ?? 0), cell: (r) => r.cac === null ? <span className="text-text-3">—</span> : <span className="tnum">{formatMoney(Number(r.cac))}</span>, mobileHidden: true },
    { key: 'revenue', header: 'הכנסה', align: 'end', value: (r) => Number(r.revenue), cell: (r) => <Money value={Number(r.revenue)} certainty="actual" />, footer: <Money value={weeks.reduce((a, r) => a + Number(r.revenue), 0)} /> },
    { key: 'roi', header: 'ROI', align: 'end', value: (r) => Number(r.roi ?? 0), cell: (r) => r.roi === null ? <span className="text-text-3">—</span> : <StatusPill tone={Number(r.roi) >= 3 ? 'actual' : Number(r.roi) >= 1 ? 'expected' : 'open'}>×{Number(r.roi).toFixed(1)}</StatusPill> },
  ]

  const leadColumns: Column<LeadRow>[] = [
    { key: 'date', header: 'תאריך', cell: (l) => formatDate(l.date) },
    { key: 'name', header: 'שם', cell: (l) => l.deal_id ? <Link href={`/deals/${l.deal_id}`} className="underline font-medium">{l.name ?? '—'}</Link> : <span>{l.name ?? '—'}</span> },
    { key: 'phone', header: 'טלפון', cell: (l) => <span dir="ltr" className="text-xs">{l.phone ?? '—'}</span>, mobileHidden: true },
    { key: 'product', header: 'מוצר', cell: (l) => <span className="text-xs">{PRODUCT_LABEL[l.product] ?? l.product}</span> },
    {
      key: 'source_name', header: 'ערוץ', value: (l) => l.source_name,
      cell: (l) => (
        <select className={selectClass} value={allSources.find((s) => s.name === l.source_name)?.id ?? ''} disabled={pending}
          onClick={(e) => e.stopPropagation()} onChange={(e) => act(() => setLeadSource(l.id, e.target.value))}>
          {allSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ),
    },
    { key: 'stage', header: 'שלב', value: (l) => l.stage, cell: (l) => <StatusPill tone={l.stage === 'signed' || l.stage === 'closed_won' ? 'actual' : l.stage === 'closed_lost' ? 'locked' : 'expected'}>{STAGE_LABEL[l.stage] ?? l.stage}</StatusPill> },
    { key: 'wise_ref', header: 'מקור', mobileHidden: true, cell: (l) => l.wise_ref ? <span className="text-xs text-text-3">WISE</span> : <span className="text-xs text-text-3">ידני</span> },
    { key: 'notes', header: 'פעילות אחרונה', mobileHidden: true, cell: (l) => <span className="text-xs text-text-3 truncate max-w-[200px] inline-block align-bottom">{l.notes ?? '—'}</span> },
  ]

  const products = [...new Set(grid.map((g) => g.product))]
  const gridSources = [...new Set(grid.map((g) => g.source_name))]
  const maxRevenue = Math.max(1, ...grid.map((g) => Number(g.revenue)))

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="לידים — 90 יום" value={totalLeads} count
          subtitle={`${signed?.count ?? 0} חתמו · ${totalLeads ? Math.round(((signed?.count ?? 0) / totalLeads) * 100) : 0}% המרה`}
          drillTitle="לפי ערוץ" drill={<SourceList rows={sources} field="leads" />} />
        <KpiCard title="עלות לידים" value={-totalCost} nature={totalCost ? 'open' : undefined}
          subtitle={totalCost ? `${formatMoney(totalLeads ? totalCost / totalLeads : 0)} לליד` : 'לא הוזנו עלויות — ה-CAC וה-ROI לא ניתנים לחישוב'}
          drillTitle="לפי ערוץ" drill={<SourceList rows={sources} field="cost" />} />
        <KpiCard title="CAC" value={cac ?? 0} nature={cac === null ? undefined : undefined}
          subtitle={cac === null ? 'אין חתימות בתקופה' : `עלות רכישת לקוח · ${signed?.count} חתימות`}
          drillTitle="CAC לפי ערוץ" drill={<SourceList rows={sources} field="cac" />} />
        <KpiCard title="נגבה מהלידים" value={collected?.amount ?? 0} certainty="actual"
          subtitle={roi === null ? 'אין עלויות להשוות מולן' : `ROI ×${roi}`}
          drillTitle="לפי ערוץ" drill={<SourceList rows={sources} field="revenue" />} />
      </div>

      {/* §5.1 — משפך בכסף, לא בכמויות */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Coins size={16} className="text-text-2" />
          <h2 className="font-semibold text-sm">המשפך — 90 יום</h2>
          <span className="text-xs text-text-3">הכמות היא המכנה; המספר שמעניין הוא הכסף</span>
        </div>
        <ul className="flex flex-col gap-2">
          {stages.map((s) => (
            <li key={s.stage} className="flex items-center gap-3 text-sm">
              <span className="w-20 shrink-0">{s.label}</span>
              <span className="flex-1 h-3 bg-locked-bg rounded">
                <span className={cn('block h-3 rounded', s.stage === 'collected' ? 'bg-actual' : s.stage === 'signed' ? 'bg-committed' : 'bg-expected')}
                  style={{ width: `${Math.round((s.count / maxCount) * 100)}%` }} />
              </span>
              <span className="w-12 text-xs text-text-2 tnum text-start">{s.count}</span>
              <span className="w-28 text-start">
                {s.amount === 0 ? <span className="text-text-3 text-xs">—</span> : <Money value={s.amount} nature={s.amount < 0 ? 'open' : undefined} certainty={s.stage === 'collected' ? 'actual' : s.stage === 'signed' ? 'committed' : undefined} />}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {flags.length > 0 && (
        <div className="flex flex-col gap-2">
          {flags.map((f) => (
            <Card key={`${f.sourceId}:${f.kind}`} className="flex flex-wrap items-center gap-2 text-sm border-s-4 border-s-open">
              <AlertTriangle size={16} className="text-open" />
              <span className="font-medium">{f.sourceName}</span>
              <span className="text-text-2">{f.label}</span>
              <span className="text-xs text-text-3 ms-auto">מסקנה אוטומטית (§3.8)</span>
            </Card>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b border-border">
        {([['weekly', `שבועי (${weeks.length})`], ['sources', `ערוצים (${sources.length})`], ['leads', `לידים (${leads.length})`], ['costs', `עלויות (${costs.length})`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn('px-3 py-2 text-sm -mb-px border-b-2', tab === k ? 'border-brand text-text font-medium' : 'border-transparent text-text-2')}>{l}</button>
        ))}
      </div>
      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      {tab === 'weekly' && (
        <DataTable rows={weeks.map((r, i) => ({ ...r, id: `${r.week}:${r.source_id}:${r.product}:${i}` }))} columns={weeklyColumns}
          exportName="conversion-weekly" primaryKeys={['week', 'source_name', 'leads']}
          emptyState="אין עדיין לידים — הייבוא מ-WISE במסך הייבוא" />
      )}

      {tab === 'sources' && (
        <div className="flex flex-col gap-4">
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="text-xs text-text-2 bg-locked-bg">
                <tr><th className="text-start p-2">ערוץ</th><th className="text-end p-2">לידים</th><th className="text-end p-2">חתמו</th><th className="text-end p-2">עלות</th><th className="text-end p-2">CAC</th><th className="text-end p-2">הכנסה</th><th className="text-end p-2">ROI</th></tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.source_id} className="border-t border-border">
                    <td className="p-2 font-medium">{s.source_name}</td>
                    <td className="p-2 text-end tnum">{s.leads}</td>
                    <td className="p-2 text-end tnum">{s.signings}</td>
                    <td className="p-2 text-end"><Money value={-Number(s.cost)} /></td>
                    <td className="p-2 text-end tnum">{s.cac === null ? '—' : formatMoney(Number(s.cac))}</td>
                    <td className="p-2 text-end"><Money value={Number(s.revenue)} certainty="actual" /></td>
                    <td className="p-2 text-end">{s.roi === null ? '—' : <StatusPill tone={Number(s.roi) >= 3 ? 'actual' : Number(s.roi) >= 1 ? 'expected' : 'open'}>×{Number(s.roi).toFixed(1)}</StatusPill>}</td>
                  </tr>
                ))}
                {!sources.length && <tr><td colSpan={7} className="p-4 text-center text-text-3">אין נתונים</td></tr>}
              </tbody>
            </table>
          </Card>

          {/* היטמאפ ערוץ × מוצר — §3.8 */}
          <Card className="flex flex-col gap-2 overflow-x-auto">
            <h3 className="font-semibold text-sm">ערוץ × מוצר — הכנסה</h3>
            <table className="text-sm min-w-[420px]">
              <thead><tr><th className="text-start p-2 text-xs text-text-2">ערוץ</th>{products.map((p) => <th key={p} className="p-2 text-xs text-text-2">{PRODUCT_LABEL[p] ?? p}</th>)}</tr></thead>
              <tbody>
                {gridSources.map((sName) => (
                  <tr key={sName}>
                    <td className="p-2">{sName}</td>
                    {products.map((p) => {
                      const cell = grid.find((g) => g.source_name === sName && g.product === p)
                      const intensity = cell ? Number(cell.revenue) / maxRevenue : 0
                      return (
                        <td key={p} className="p-1">
                          <div className="rounded p-2 text-center text-xs tnum" style={{ backgroundColor: `color-mix(in srgb, var(--color-actual) ${Math.round(intensity * 70)}%, transparent)` }}>
                            {cell ? `${cell.leads} · ${formatMoney(Number(cell.revenue), { cents: false })}` : '—'}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {!gridSources.length && <tr><td className="p-4 text-center text-text-3" colSpan={products.length + 1}>אין נתונים</td></tr>}
              </tbody>
            </table>
          </Card>

          <Card className="flex flex-wrap items-center gap-3 text-sm">
            <Building2 size={16} className="text-text-2" />
            <span className="font-medium">הגשות לבנקים</span>
            <span className="text-text-2">{submissions.total} הגשות · {submissions.approved} אושרו</span>
            <span className="text-xs text-text-3">§4.5 — ההגשה מקדמת את התיק ל"הוגש", ואישור ל"מאושר עקרונית", וזה מזין את ההסתברות בתזרים</span>
            {submissions.banks.length > 0 && (
              <span className="w-full text-xs text-text-2">
                {submissions.banks.map((b) => `${b.bank}: ${b.n}${b.approved ? ` (${b.approved} אושרו)` : ''}`).join(' · ')}
              </span>
            )}
          </Card>
        </div>
      )}

      {tab === 'leads' && (
        <DataTable rows={leads} columns={leadColumns} exportName="leads" primaryKeys={['date', 'name', 'stage']}
          emptyState="אין לידים במערכת — לייבא מ-WISE במסך הייבוא" initialSort={{ key: 'date', dir: 'desc' }} />
      )}

      {tab === 'costs' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ActionDrawerForm title="עלות לידים" action={addLeadCost} submitLabel="שמור"
              trigger={<Button variant="primary" type="button"><Plus size={16} /> עלות חדשה</Button>}>
              <Field label="ערוץ" required><Select name="source_id" required>{allSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="תאריך" required><Input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
                <Field label="סכום" required><Input name="amount" inputMode="decimal" required /></Field>
              </div>
              <Field label="לפרוס על כמה שבועות" hint="חבילה של 2.5 חודשים ≈ 11 שבועות — כדי שה-CAC לא יקפוץ בשבוע אחד">
                <Input name="spread_weeks" inputMode="numeric" defaultValue="1" />
              </Field>
              <Field label="הערה"><Input name="note" /></Field>
            </ActionDrawerForm>
            <ActionDrawerForm title="ערוץ חדש" action={addLeadSource} submitLabel="הוסף"
              trigger={<Button variant="ghost" type="button"><Plus size={16} /> ערוץ</Button>}>
              <Field label="שם" required hint="אבינועם · אלכס · פייסבוק · גוגל · הפניה · רכב-לנדינג"><Input name="name" required /></Field>
              <Field label="מודל עלות" required>
                <Select name="cost_model" defaultValue="per_lead">
                  <option value="per_lead">לפי ליד</option><option value="monthly">חודשי</option><option value="pct">אחוז</option>
                </Select>
              </Field>
              <Field label="עלות ליחידה"><Input name="unit_cost" inputMode="decimal" /></Field>
            </ActionDrawerForm>
          </div>
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead className="text-xs text-text-2 bg-locked-bg"><tr><th className="text-start p-2">תאריך</th><th className="text-start p-2">ערוץ</th><th className="text-end p-2">סכום</th><th className="text-start p-2">הערה</th><th /></tr></thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-2">{formatDate(c.date)}</td>
                    <td className="p-2">{c.source_name}</td>
                    <td className="p-2 text-end"><Money value={-Number(c.amount)} /></td>
                    <td className="p-2 text-xs text-text-3">{c.note ?? '—'}</td>
                    <td className="p-2 text-end">
                      <Button size="sm" variant="ghost" disabled={pending} title="בטל"
                        onClick={() => { if (confirm('לבטל את שורת העלות?')) act(() => deleteLeadCost(c.id)) }}><Trash2 size={14} /></Button>
                    </td>
                  </tr>
                ))}
                {!costs.length && <tr><td colSpan={5} className="p-4 text-center text-text-3">לא הוזנו עלויות — בלעדיהן אין CAC ואין ROI</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  )
}

function SourceList({ rows, field }: { rows: SourceSummary[]; field: 'leads' | 'cost' | 'cac' | 'revenue' }) {
  if (!rows.length) return <p className="text-sm text-text-3">אין נתונים</p>
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((s) => (
        <li key={s.source_id} className="flex justify-between gap-2 py-2">
          <span className="truncate">{s.source_name} · {s.leads} לידים · {s.signings} חתמו</span>
          <span className="tnum shrink-0">
            {field === 'leads' ? s.leads
              : field === 'cost' ? formatMoney(-Number(s.cost))
              : field === 'cac' ? (s.cac === null ? '—' : formatMoney(Number(s.cac)))
              : formatMoney(Number(s.revenue))}
          </span>
        </li>
      ))}
    </ul>
  )
}
