import Link from 'next/link'
import { Anchor as AnchorIcon, ChevronRight } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { Card } from '@/components/ui/card'
import { Money } from '@/components/money'
import { StaleBadge } from '@/components/stale-badge'
import { activeAlertCount } from '@/lib/queries/common'
import { anchorHistory, bankAccount, latestAnchor } from '@/lib/queries/cashflow'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { formatDate } from '@/lib/ui/format'
import { AnchorForm } from './form'

export const dynamic = 'force-dynamic'

/** מסך העוגן — הזרימה הקריטית בנייד (UIUX §6). קריטריון §9 שלב 5: "דן מזין יתרה מהנייד יומית". */
export default async function AnchorPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const { period, division } = readGlobalParams(sp, now)
  const account = await bankAccount()
  const [current, history, alerts] = await Promise.all([
    account ? latestAnchor(account.id) : null, account ? anchorHistory(account.id, 14) : [], activeAlertCount(),
  ])

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5 max-w-xl">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-text-2 hover:text-text inline-flex items-center gap-1 text-sm"><ChevronRight size={16} /> מצב</Link>
          <AnchorIcon size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">עוגן יומי</h1>
        </div>
        <Card className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text-2">{account?.name ?? 'אין חשבון בנק'} · {formatDate(today)}</span>
            <StaleBadge updatedAt={current ? `${current.date}T12:00:00Z` : null} now={now} />
          </div>
          {account ? <AnchorForm today={today} current={current} /> : <p className="text-open text-sm">יש להגדיר חשבון בנק לפני הזנת עוגן.</p>}
        </Card>
        <Card>
          <h2 className="text-sm text-text-2 font-medium mb-2">14 הימים האחרונים</h2>
          {history.length ? (
            <ul className="divide-y divide-border text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between py-2">
                  <span>{formatDate(h.date)}{h.source === 'statement_import' ? ' · מדף בנק' : ''}</span>
                  <span className="flex gap-3"><Money value={h.balance} certainty="actual" />{h.available_credit != null && <span className="text-text-3 text-xs self-center">מסגרת {Math.round(h.available_credit).toLocaleString('he-IL')}</span>}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-text-3">עדיין לא הוזן עוגן.</p>}
        </Card>
      </main>
    </>
  )
}
