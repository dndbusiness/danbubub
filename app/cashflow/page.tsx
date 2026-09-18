import Link from 'next/link'
import { TrendingUp } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { KpiCard } from '@/components/kpi-card'
import { Card } from '@/components/ui/card'
import { Money } from '@/components/money'
import { StaleBadge } from '@/components/stale-badge'
import { RiskBanner } from '@/components/risk-banner'
import { activeAlertCount } from '@/lib/queries/common'
import { bankAccount, dailyCloses, latestAnchor, loadCashflow, txBetween } from '@/lib/queries/cashflow'
import { riskMode } from '@/lib/queries/dashboard'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { formatDate, formatMoneyInline } from '@/lib/ui/format'
import { AnchorForm } from '@/app/anchor/form'
import { CashflowView } from './client'

export const dynamic = 'force-dynamic'

/** מסך 3 — תזרים 13 שבועות (SPEC §3.6, UIUX §5.4). */
export default async function CashflowPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const { period, division } = readGlobalParams(sp, now)
  const [alerts, risk, account, closes] = await Promise.all([activeAlertCount(), riskMode(), bankAccount(), dailyCloses(30)])
  const current = account ? await latestAnchor(account.id) : null
  const cf = await loadCashflow(today)
  const ok = 'error' in cf ? null : cf
  const recorded: Record<string, Awaited<ReturnType<typeof txBetween>>> = {}
  if (account) for (const c of closes.slice(0, 10)) recorded[c.id] = await txBetween(account.id, c.previous_anchor_date, c.date)

  const monthEnd = `${period}-${new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()}`
  const committedMonth = ok ? ok.items.filter((i) => i.certainty === 'committed' && i.amount < 0 && i.date >= today && i.date <= monthEnd) : []
  const committedIn90 = ok ? ok.items.filter((i) => i.certainty === 'committed' && i.amount > 0) : []
  const list = (rows: { date: string; label: string; amount: number }[]) => (
    <ul className="divide-y divide-border text-sm">{rows.length ? rows.map((r, i) => <li key={i} className="flex justify-between gap-2 py-2"><span>{formatDate(r.date)} · {r.label}</span><Money value={r.amount} certainty="committed" /></li>) : <li className="py-2 text-text-3">אין</li>}</ul>
  )

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      {risk.is_risk_mode && <RiskBanner message={ok?.result.lowPoint ? `נקודה נמוכה ${formatMoneyInline(ok.result.lowPoint.balance, { cents: false })} ב-${formatDate(ok.result.lowPoint.date)}` : `${risk.critical_count} התראות קריטיות`} />}
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <TrendingUp size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">תזרים 13 שבועות</h1>
          {ok && <span className="text-xs text-text-3">מעוגן {formatDate(ok.anchor.date)} · {ok.account.name}</span>}
        </div>

        {/* 4 מספרי הבוקר (SPEC §5 מסך 1) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="יש עכשיו" value={current?.balance ?? 0} certainty="actual" subtitle={<StaleBadge updatedAt={current ? `${current.date}T12:00:00Z` : null} now={now} />} drillTitle="העוגן" drill={<p className="text-sm">{current ? `עוגן ${formatDate(current.date)} · ${current.source === 'manual' ? 'הוזן ידנית' : 'מדף בנק'}` : 'לא הוזן עוגן'}</p>} />
          <KpiCard title="מחויב עד סוף החודש" value={-committedMonth.reduce((a, i) => a + i.amount, 0)} nature="open" subtitle={`${committedMonth.length} חיובים ודאיים`} drillTitle="חיובים ודאיים החודש" drill={list(committedMonth)} />
          <KpiCard title="צפוי ודאי (13 שבועות)" value={committedIn90.reduce((a, i) => a + i.amount, 0)} certainty="committed" subtitle={`${committedIn90.length} תקבולים committed`} drillTitle="תקבולים ודאיים" drill={list(committedIn90)} />
          <KpiCard title="נקודה נמוכה ב-90 יום" value={ok?.result.lowPoint?.balance ?? 0} certainty="committed" nature={ok?.result.lowPoint && ok.result.lowPoint.balance < 0 ? 'open' : undefined} subtitle={ok?.result.lowPoint ? `ב-${formatDate(ok.result.lowPoint.date)}${ok.result.firstNegativeWeek ? ` · שלילי מ-${formatDate(ok.result.firstNegativeWeek)}` : ''}` : '—'} drillTitle="השבוע הנמוך" drill={ok?.result.lowPoint ? list(ok.result.weeks.find((w) => ok.result.lowPoint!.date >= w.weekStart && ok.result.lowPoint!.date <= w.weekEnd)?.items ?? []) : <p className="text-sm text-text-3">אין תזרים</p>} />
        </div>

        {/* עוגן inline — UIUX §5.4 */}
        <Card className="flex flex-col gap-2">
          <div className="flex items-center justify-between"><h2 className="text-sm text-text-2 font-medium">עוגן היום</h2><Link href="/anchor" className="text-xs underline text-text-2">מסך העוגן (נייד)</Link></div>
          {account ? <AnchorForm today={today} current={current} inline /> : <p className="text-sm text-open">אין חשבון בנק פעיל.</p>}
        </Card>

        {ok ? (
          <CashflowView weeks={ok.result.weeks} items={ok.items} lowPoint={ok.result.lowPoint} creditLine={current?.available_credit ?? null} closes={closes} today={today} recorded={recorded} />
        ) : (
          <Card className="text-sm text-text-2">{'error' in cf ? cf.error : ''}</Card>
        )}
      </main>
    </>
  )
}
