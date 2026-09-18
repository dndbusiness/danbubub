import { Link2 } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { activeAlertCount } from '@/lib/queries/common'
import { listLinks } from '@/lib/queries/tasks'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { LinksView } from './client'

export const dynamic = 'force-dynamic'

/** מסך 17 — קישורים למערכות עבודה (SPEC §5), לפי קטגוריה, ניתן לעריכה. */
export default async function LinksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period, division } = readGlobalParams(sp, new Date().toISOString())
  const [links, alerts] = await Promise.all([listLinks(), activeAlertCount()])

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link2 size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">קישורים</h1>
          <span className="text-xs text-text-3">המערכות שעובדים איתן ביום-יום — WISE, חשבונית ירוקה, הבנק, הרו״ח</span>
        </div>
        <LinksView links={links} />
      </main>
    </>
  )
}
