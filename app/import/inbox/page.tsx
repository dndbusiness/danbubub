import Link from 'next/link'
import { ChevronRight, Inbox } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { activeAlertCount } from '@/lib/queries/common'
import { listCandidates, matchOptions, supplierOptions } from '@/lib/queries/intake'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { InboxQueue } from './client'

export const dynamic = 'force-dynamic'

/** מסך 11 — תור הקליטה ממייל / דרייב / העלאה (ADDENDUM ב.3). */
export default async function InboxPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period, division } = readGlobalParams(sp, new Date().toISOString())
  const [candidates, suppliers, alerts] = await Promise.all([listCandidates('all'), supplierOptions(), activeAlertCount()])
  const matches: Record<string, Awaited<ReturnType<typeof matchOptions>>> = {}
  for (const c of candidates.filter((x) => x.status === 'pending' && x.kind !== 'statement').slice(0, 30)) matches[c.id] = await matchOptions(c.extracted)
  const pending = candidates.filter((c) => c.status === 'pending').length
  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/import" className="text-text-2 hover:text-text inline-flex items-center gap-1 text-sm"><ChevronRight size={16} /> ייבוא</Link>
          <Inbox size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">קליטת חשבוניות</h1>
          <span className="text-xs text-text-3">{pending} ממתינות · Gmail כל 15 דק׳ · תיקיית "להזנה" בדרייב · העלאה מהנייד</span>
        </div>
        <InboxQueue candidates={candidates} suppliers={suppliers} matches={matches} />
      </main>
    </>
  )
}
