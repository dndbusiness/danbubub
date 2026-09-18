import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, FileUp } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { activeAlertCount, listCategories } from '@/lib/queries/common'
import { getBatch } from '@/lib/queries/imports'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { formatDate } from '@/lib/ui/format'
import { BatchReview } from './review'

export const dynamic = 'force-dynamic'

/** מסך 11 שלבים 2–3 — אישור אצוות אשראי והחלה. */
export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params
  const sp = await searchParams
  const now = new Date().toISOString()
  const { period, division } = readGlobalParams(sp, now)
  const data = await getBatch(id)
  if (!data?.batch.meta) notFound()
  const { batch, rows } = data
  const meta = batch.meta!
  const [categories, alerts] = await Promise.all([listCategories(), activeAlertCount()])
  // הקטגוריה "לא מסווג" היא נחיתה אוטומטית, לא בחירה ידנית.
  const selectable = categories.filter((c) => !c.name.startsWith('לא מסווג'))

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/import" className="text-text-2 hover:text-text inline-flex items-center gap-1 text-sm"><ChevronRight size={16} /> ייבוא</Link>
          <FileUp size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">
            זוהה: {meta.formatLabel} · {rows.length} שורות · {formatDate(meta.dateFrom)}–{formatDate(meta.dateTo)} · חיוב {formatDate(meta.billingDate)}
          </h1>
          <span className="text-xs text-text-3" dir="ltr">{batch.file_name}</span>
          {batch.account_name && <span className="text-xs text-text-3">· {batch.account_name}</span>}
        </div>
        <BatchReview batch={batch} rows={rows} categories={selectable} existing={sp.existing === '1'} />
      </main>
    </>
  )
}
