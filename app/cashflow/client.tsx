'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Ban, CalendarClock, Repeat, Tag } from 'lucide-react'
import { resolveDailyClose } from '@/app/actions/cashflow'
import { CashflowChart, type CashflowPoint } from '@/components/charts/cashflow-chart'
import { DrillDrawer } from '@/components/drill-drawer'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CertaintyPill, StatusPill } from '@/components/status-pill'
import type { CashflowItem, CashflowWeek } from '@/lib/rules/cashflow'
import type { DailyCloseRow } from '@/lib/queries/cashflow'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

const KIND: Record<string, string> = { receipt: 'תקבול', fixed_expense: 'הוצאה קבועה', advance: 'מקדמה לניסים', vat: 'מע"מ', tax: 'מס' }

function weekLabel(w: CashflowWeek): string {
  const n = Math.ceil((Date.parse(w.weekStart) - Date.parse(`${w.weekStart.slice(0, 4)}-01-01`)) / 604_800_000) + 1
  return `שבוע ${n} · ${w.weekStart.slice(8, 10)}–${w.weekEnd.slice(8, 10)}/${Number(w.weekEnd.slice(5, 7))}`
}

/** UIUX §5.4 — גרף, טבלת שבועות, יומן 30 יום, טאב סטיות. */
export function CashflowView({ weeks, items, lowPoint, creditLine, closes, today, recorded }: {
  weeks: CashflowWeek[]
  items: CashflowItem[]
  lowPoint: { date: string; balance: number } | null
  creditLine: number | null
  closes: DailyCloseRow[]
  today: string
  recorded: Record<string, { id: string; date_cash: string; description: string | null; counterparty: string | null; amount_gross: number }[]>
}) {
  const router = useRouter()
  const [tab, setTab] = React.useState<'weeks' | 'calendar' | 'variance'>('weeks')
  const [drill, setDrill] = React.useState<CashflowWeek | null>(null)
  const [pending, start] = React.useTransition()
  const points: CashflowPoint[] = weeks.map((w) => ({ weekStart: w.weekStart, weekEnd: w.weekEnd, label: `${w.weekStart.slice(8, 10)}/${Number(w.weekStart.slice(5, 7))}`, committed: w.balanceCommitted, weighted: w.balanceWeighted }))
  const lowWeek = lowPoint ? weeks.find((w) => lowPoint.date >= w.weekStart && lowPoint.date <= w.weekEnd) : null
  const openCloses = closes.filter((c) => c.status === 'open')
  const resolve = (id: string, r: Parameters<typeof resolveDailyClose>[1]) => start(async () => { await resolveDailyClose(id, r); router.refresh() })

  // יומן 30 יום — לפי יום; ימים "דחוסים" (>50K) מודגשים
  const to30 = new Date(`${today}T00:00:00Z`); to30.setUTCDate(to30.getUTCDate() + 30)
  const days = new Map<string, CashflowItem[]>()
  for (const i of items) if (i.date >= today && i.date <= to30.toISOString().slice(0, 10)) days.set(i.date, [...(days.get(i.date) ?? []), i])

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex items-center gap-3 text-xs text-text-2 mb-2">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-committed inline-block" /> ודאי בלבד</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-expected inline-block border-dashed" /> ודאי + פוטנציאל משוקלל</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-open inline-block" /> אפס</span>
          <span className="ms-auto">לחיצה על שבוע פותחת את השורות</span>
        </div>
        <CashflowChart points={points} creditLine={creditLine} lowPoint={lowWeek && lowPoint ? { weekStart: lowWeek.weekStart, balance: lowPoint.balance } : null} onWeek={(ws) => setDrill(weeks.find((w) => w.weekStart === ws) ?? null)} />
      </Card>

      <div className="flex gap-1 border-b border-border">
        {([['weeks', 'שבועות'], ['calendar', 'יומן 30 יום'], ['variance', `סטיות${openCloses.length ? ` (${openCloses.length})` : ''}`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn('px-3 py-2 text-sm -mb-px border-b-2', tab === k ? 'border-brand text-text font-medium' : 'border-transparent text-text-2')}>{l}</button>
        ))}
      </div>

      {tab === 'weeks' && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-xs text-text-2 bg-locked-bg"><tr><th className="text-start p-2">שבוע</th><th className="text-end p-2">נכנס ודאי</th><th className="text-end p-2">יוצא ודאי</th><th className="text-end p-2">פוטנציאל משוקלל</th><th className="text-end p-2">יתרה ודאי</th><th className="text-end p-2">יתרה משוקללת</th></tr></thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStart} onClick={() => setDrill(w)} className={cn('border-t border-border cursor-pointer hover:bg-locked-bg', w.balanceCommitted < 0 && 'bg-open-bg')}>
                  <td className="p-2 whitespace-nowrap">{weekLabel(w)}</td>
                  <td className="p-2 text-end"><Money value={w.committedIn} certainty="committed" /></td>
                  <td className="p-2 text-end"><Money value={-w.committedOut} certainty="committed" /></td>
                  <td className="p-2 text-end"><Money value={w.expectedIn - w.expectedOut} certainty="expected" /></td>
                  <td className="p-2 text-end font-medium"><Money value={w.balanceCommitted} certainty="committed" nature={w.balanceCommitted < 0 ? 'open' : undefined} /></td>
                  <td className="p-2 text-end"><Money value={w.balanceWeighted} certainty="expected" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'calendar' && (
        <div className="flex flex-col gap-2">
          {!days.size && <Card className="text-sm text-text-2">אין חיובים או תקבולים צפויים ב-30 הימים הקרובים.</Card>}
          {[...days.entries()].map(([date, list]) => {
            const out = -list.filter((i) => i.amount < 0).reduce((a, i) => a + i.amount, 0)
            const dense = out > 50_000
            return (
              <Card key={date} className={cn('flex flex-col gap-1 border-s-4', dense ? 'border-s-open' : 'border-s-border')}>
                <div className="flex items-center gap-2 text-sm"><CalendarClock size={14} className="text-text-3" /><span className="font-medium">{formatDate(date)}</span>{dense && <StatusPill tone="open">יום דחוס</StatusPill>}<span className="ms-auto text-xs text-text-3">יוצא {formatMoney(out)}</span></div>
                <ul className="divide-y divide-border text-sm">
                  {list.map((i, n) => <li key={n} className="flex justify-between gap-2 py-1"><span className="truncate">{i.label} <span className="text-text-3 text-xs">· {KIND[i.kind] ?? i.kind}</span></span><span className="flex items-center gap-2"><CertaintyPill certainty={i.certainty} /><Money value={i.amount} certainty={i.certainty} /></span></li>)}
                </ul>
              </Card>
            )
          })}
        </div>
      )}

      {tab === 'variance' && (
        <div className={cn('flex flex-col gap-2', pending && 'opacity-70')}>
          {!closes.length && <Card className="text-sm text-text-2">עדיין אין סגירות יום. סגירת יום נוצרת עם כל עוגן (§3.6).</Card>}
          {closes.map((c) => (
            <Card key={c.id} className={cn('flex flex-col gap-2', c.status === 'open' && 'border-s-4 border-s-expected')}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{formatDate(c.date)}</span>
                {c.status === 'open' ? <StatusPill tone="expected">מה קרה?</StatusPill> : c.status === 'ok' ? <StatusPill tone="actual">תקין</StatusPill> : <StatusPill tone="locked">{c.status === 'ignored' ? 'התעלמנו' : c.status === 'fixed_expense' ? 'הוצאה קבועה' : 'סווג'}</StatusPill>}
                <span className="text-text-2">צפי {formatMoney(c.predicted)} · בפועל {formatMoney(c.actual)} · סטייה</span><Money value={c.variance} nature={c.exceeds_threshold ? 'open' : undefined} />
                <span className="text-text-2 ms-auto">לא מוסבר</span><Money value={c.unexplained} nature={c.status === 'open' ? 'open' : undefined} />
              </div>
              {c.previous_anchor_date && (
                <details className="text-xs text-text-2"><summary className="cursor-pointer">מה נרשם בין {formatDate(c.previous_anchor_date)} ל-{formatDate(c.date)} ({(recorded[c.id] ?? []).length})</summary>
                  <ul className="mt-1 divide-y divide-border">{(recorded[c.id] ?? []).map((t) => <li key={t.id} className="flex justify-between py-1"><span>{formatDate(t.date_cash)} · {t.description ?? t.counterparty ?? '—'}</span><Money value={t.amount_gross} /></li>)}</ul>
                </details>
              )}
              {c.status === 'open' && (
                <div className="flex flex-wrap gap-2">
                  <Link href={`/transactions?quick=new&amount=${Math.abs(c.unexplained)}&date=${c.date}&close=${c.id}`} prefetch={false}><Button size="sm" variant="primary"><Tag size={14} /> סווג</Button></Link>
                  <Link href={`/fixed-expenses?quick=new&amount=${Math.abs(c.unexplained)}&close=${c.id}`} prefetch={false}><Button size="sm"><Repeat size={14} /> זו הוצאה קבועה חדשה</Button></Link>
                  <Button size="sm" variant="ghost" onClick={() => resolve(c.id, { status: 'ignored', note: 'התעלמנו' })}><Ban size={14} /> התעלם</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <DrillDrawer open={Boolean(drill)} onOpenChange={(o) => !o && setDrill(null)} title={drill ? weekLabel(drill) : ''}>
        {drill && (
          <ul className="divide-y divide-border text-sm">
            {!drill.items.length && <li className="py-2 text-text-3">אין פריטים בשבוע זה</li>}
            {drill.items.map((i, n) => <li key={n} className="flex justify-between gap-2 py-2"><span>{formatDate(i.date)} · {i.label}<span className="text-text-3 text-xs"> · {KIND[i.kind] ?? i.kind}{i.certainty === 'expected' ? ` · ${Math.round(i.probability * 100)}%` : ''}</span></span><Money value={i.amount} certainty={i.certainty} /></li>)}
            <li className="flex justify-between pt-2 font-medium"><span>יתרה בסוף השבוע (ודאי)</span><Money value={drill.balanceCommitted} certainty="committed" /></li>
          </ul>
        )}
      </DrillDrawer>
    </div>
  )
}
