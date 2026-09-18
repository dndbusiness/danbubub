import Link from 'next/link'
import { AlertTriangle, Anchor, Building2 } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { KpiCard } from '@/components/kpi-card'
import { Card } from '@/components/ui/card'
import { Money } from '@/components/money'
import { StaleBadge } from '@/components/stale-badge'
import { RiskBanner } from '@/components/risk-banner'
import { Button } from '@/components/ui/button'
import { activeAlertCount } from '@/lib/queries/common'
import { bankAccount, latestAnchor, loadCashflow } from '@/lib/queries/cashflow'
import { attentionCounts, collectedByMonth, collectionsSummary, listAlerts, profitSummary, riskMode, settlementSummary, upcomingFromItems } from '@/lib/queries/dashboard'
import { fixedExpenseMonths, listFixedExpenses } from '@/lib/queries/fixed-expenses'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { HomeCharts } from './home-client'

export const dynamic = 'force-dynamic'

/**
 * מסך 21 "מצב החברה" — ADDENDUM ב.8 (דף הבית; מסך הבוקר הוא הקובייה הראשונה).
 * שש קוביות עם מספר גדול ו-drill-down, פס KPI (SPEC §5.1), גרפים. מובייל: 6 הקוביות בעמודה.
 */
export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const { period, division } = readGlobalParams(sp, now)
  const pnlDivision = division === 'realestate' ? 'realestate' : 'finance'
  const account = await bankAccount()
  const [alertCount, risk, anchor, cf, counts, coll, profit, settle, collected, alerts, fixed] = await Promise.all([
    activeAlertCount(), riskMode(), account ? latestAnchor(account.id) : null, loadCashflow(today), attentionCounts(),
    collectionsSummary(division), profitSummary(period, pnlDivision), settlementSummary(period, today),
    collectedByMonth(division, 6, period), listAlerts(), listFixedExpenses(),
  ])
  const ok = 'error' in cf ? null : cf
  const monthEnd = `${period}-${new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()}`
  const upcoming = upcomingFromItems(ok?.items ?? [], today, monthEnd)
  const fxMonths = await fixedExpenseMonths(fixed, period, today, 1)
  const notDebited = fixed.filter((f) => (fxMonths.get(f.id) ?? []).some((m) => m.status === 'missing'))
  const low30 = ok ? ok.result.weeks.slice(0, 5).reduce<{ date: string; balance: number } | null>((m, w) => (!m || w.balanceCommitted < m.balance ? { date: w.weekEnd, balance: w.balanceCommitted } : m), null) : null
  const attentionTotal = counts.unknown_tx + counts.missing_invoices + counts.inbox_pending + counts.open_questions + counts.overdue_tasks + counts.active_alerts + counts.open_closes

  const Line = ({ href, label, n }: { href: string; label: string; n: number }) => (
    <li className="flex justify-between gap-3 py-1"><Link href={href} prefetch={false} className={n ? 'underline' : 'text-text-3'}>{label}</Link><span className={n ? 'font-medium text-open tnum' : 'text-text-3 tnum'}>{n}</span></li>
  )

  return (
    <>
      <Topbar period={period} division={division} alertCount={alertCount} />
      {risk.is_risk_mode && <RiskBanner message={ok?.result.lowPoint ? `נקודה נמוכה ${formatMoney(ok.result.lowPoint.balance)} ב-${formatDate(ok.result.lowPoint.date)}` : `${risk.critical_count} התראות קריטיות`} />}
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Building2 size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">מצב החברה</h1>
          <span className="text-xs text-text-3">{formatDate(today)}</span>
          <Link href="/anchor" prefetch={false} className="ms-auto"><Button variant={anchor?.date === today ? 'secondary' : 'primary'} size="sm"><Anchor size={14} /> {anchor?.date === today ? 'עדכן עוגן' : 'הזן עוגן'}</Button></Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* 1. מזומן — 3.6 */}
          <KpiCard title="מזומן" value={anchor?.balance ?? 0} certainty="actual" className="sm:row-span-1"
            subtitle={<span className="flex flex-col gap-0.5"><StaleBadge updatedAt={anchor ? `${anchor.date}T12:00:00Z` : null} now={now} />
              {anchor?.available_credit != null && <span>מסגרת פנויה {formatMoney(anchor.available_credit)}</span>}
              {low30 && <span className={low30.balance < 0 ? 'text-open' : ''}>נקודה נמוכה 30 יום: {formatMoney(low30.balance)} · {formatDate(low30.date)}</span>}
              {ok?.result.lowPoint && <span className={ok.result.lowPoint.balance < 0 ? 'text-open' : ''}>90 יום: {formatMoney(ok.result.lowPoint.balance)} · {formatDate(ok.result.lowPoint.date)}</span>}</span>}
            drillTitle="תזרים" drill={<div className="flex flex-col gap-2 text-sm">{ok ? ok.result.weeks.slice(0, 6).map((w) => <div key={w.weekStart} className="flex justify-between"><span>{formatDate(w.weekStart)}–{formatDate(w.weekEnd)}</span><Money value={w.balanceCommitted} certainty="committed" /></div>) : <p>{'error' in cf ? cf.error : ''}</p>}<Link href="/cashflow" className="underline">למסך התזרים</Link></div>} />

          {/* 2. הוצאות קרובות — fixed_expenses */}
          <KpiCard title="הוצאות קרובות" value={upcoming.in7Total} nature="open" subtitle={<span className="flex flex-col gap-0.5"><span>7 ימים · עד סוף החודש: {formatMoney(upcoming.monthTotal)}</span>
              {upcoming.top3.map((i, n) => <span key={n} className="truncate">{i.label} · {formatMoney(-i.amount)} · {formatDate(i.date)}</span>)}
              {notDebited.length > 0 && <span className="text-open inline-flex items-center gap-1"><AlertTriangle size={12} /> לא ירד כמצופה: {notDebited.map((f) => f.name).join(', ')}</span>}</span>}
            drillTitle="יוצא עד סוף החודש" drill={<ul className="divide-y divide-border text-sm">{upcoming.toMonthEnd.map((i, n) => <li key={n} className="flex justify-between py-1"><span>{formatDate(i.date)} · {i.label}</span><Money value={i.amount} certainty={i.certainty} /></li>)}{!upcoming.toMonthEnd.length && <li className="text-text-3 py-1">אין</li>}</ul>} />

          {/* 3. התחשבנות — 3.3, 3.5 */}
          <KpiCard title="התחשבנות" value={settle.balance ?? 0} certainty="committed" nature={settle.balance !== null && settle.balance < 0 ? 'open' : undefined}
            subtitle={<span className="flex flex-col gap-0.5"><span>{settle.balance === null ? 'אין כרטיס לחודש' : settle.balance >= 0 ? 'ניסים חייב לחברה (משוער MTD)' : 'החברה חייבת לניסים (משוער MTD)'}</span><span>מקדמות החודש {formatMoney(settle.advances)}</span>
              <span>{settle.closed ? 'החודש סגור ✓' : `סגירה בעוד ${settle.daysToClose} ימים`}</span><span className="text-text-3">נדל"ן: משיכות מול יעד — שלב 7</span></span>}
            drillTitle="כרטיס ניסים" drill={<div className="text-sm flex flex-col gap-1"><Link href={`/nissim?period=${period}`} className="underline">לכרטיס ניסים 🔒</Link></div>} />

          {/* 4. גביה וביצוע — ב.5, ב.6 */}
          <KpiCard title="גביה וביצוע" value={coll.committed} certainty="committed" subtitle={<span className="flex flex-col gap-0.5"><span>ודאי · פוטנציאל {formatMoney(coll.expected)}</span>
              {coll.top.map((d, n) => <span key={d.deal_id} className="truncate">{n + 1}. {d.client_name} {formatMoney(d.open_amount)} — {d.next_missing ? `חסר: ${d.next_missing}` : d.days_overdue > 0 ? `${d.days_overdue} ימי איחור` : 'בתהליך'}</span>)}</span>}
            drillTitle="פתוח לגביה" drill={<ul className="divide-y divide-border text-sm">{coll.all.map((d) => <li key={d.deal_id} className="flex justify-between gap-2 py-1"><Link href={`/deals/${d.deal_id}`} className="underline truncate">{d.client_name}</Link><span className="text-text-3 text-xs truncate">{d.next_missing ?? ''}</span><Money value={d.open_amount} certainty="committed" /></li>)}{!coll.all.length && <li className="text-text-3 py-1">אין יתרות פתוחות</li>}</ul>} />

          {/* 5. רווח MTD — 3.2 */}
          <KpiCard title="רווח החודש" value={profit.distributable} certainty="actual" nature={profit.distributable < 0 ? 'open' : undefined}
            subtitle={<span className="flex flex-col gap-0.5"><span>לחלוקה · תפעולי {formatMoney(profit.operational)}</span>{profit.target != null && <span>יעד {formatMoney(profit.target)} · {Math.round((profit.distributable / profit.target) * 100)}%</span>}
              <span className="text-text-3 flex gap-2">{profit.series.map((s) => { const k = Math.round(s.distributable / 1000); return <bdi key={s.month} dir="ltr" className="tnum">{s.month.slice(5)}: {k < 0 ? '\u2212' : ''}{Math.abs(k)}K</bdi> })}</span></span>}
            drillTitle="רווח והפסד" drill={<div className="text-sm flex flex-col gap-1">{profit.series.map((s) => <div key={s.month} className="flex justify-between"><Link href={`/pnl?period=${s.month}`} className="underline">{s.month}</Link><span className="flex gap-3"><Money value={s.operational} /><Money value={s.distributable} certainty="actual" /></span></div>)}</div>} />

          {/* 6. דורש טיפול — ב.11 */}
          <KpiCard title="דורש טיפול" value={attentionTotal} count nature={attentionTotal ? 'open' : undefined}
            subtitle={<ul className="flex flex-col">
              <Line href="/transactions" label="תנועות לא מזוהות" n={counts.unknown_tx} />
              <Line href="/transactions" label="בלי חשבונית (90 יום)" n={counts.missing_invoices} />
              <Line href="/alerts" label="התראות פעילות" n={counts.active_alerts} />
              <Line href="/cashflow" label="סגירות יום פתוחות" n={counts.open_closes} />
              <Line href="/tasks" label="משימות באיחור" n={counts.overdue_tasks} />
              <Line href="/questions" label="שאלות לשותפים" n={counts.open_questions} />
              <Line href="/import/inbox" label="במייל לאישור" n={counts.inbox_pending} />
            </ul>}
            drillTitle="התראות פעילות" drill={<ul className="divide-y divide-border text-sm">{alerts.map((a) => <li key={a.id} className="py-1 flex justify-between gap-2"><span>{a.title}</span><span className="text-xs text-text-3">{a.severity === 'critical' ? 'קריטי' : a.severity === 'high' ? 'גבוה' : 'מידע'}</span></li>)}{!alerts.length && <li className="text-text-3 py-1">אין התראות פעילות</li>}<li className="pt-2"><Link href="/alerts" className="underline">לכל ההתראות</Link></li></ul>} />
        </div>

        {/* פס KPI בסגנון WISE — SPEC §5.1 */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label: 'נגבה החודש', value: collected.at(-1)?.actual ?? 0, certainty: 'actual' as const },
            { label: 'פתוח ודאי', value: coll.committed, certainty: 'committed' as const },
            { label: 'פוטנציאל משוקלל', value: coll.expected, certainty: 'expected' as const },
            { label: 'הוצאות התקופה', value: -(profit.income - profit.operational), nature: 'open' as const },
            { label: 'רווח לחלוקה', value: profit.distributable, certainty: 'actual' as const },
            { label: 'יתרת ניסים 🔒', value: settle.balance ?? 0, certainty: 'committed' as const },
          ].map((k) => (
            <Card key={k.label} className="p-3"><div className="text-xs text-text-2">{k.label}</div><Money value={k.value} certainty={k.certainty} nature={k.nature} size="lg" /></Card>
          ))}
        </div>

        <HomeCharts collected={collected} target={profit.target} />
      </main>
    </>
  )
}
