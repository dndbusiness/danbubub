import { HelpCircle } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { activeAlertCount, listCategories } from '@/lib/queries/common'
import { listQuestions, questionCounts } from '@/lib/queries/tasks'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { QuestionsView } from './client'

export const dynamic = 'force-dynamic'

/**
 * מסך 16 — שאלות לשותפים (SPEC §5). מובייל-first (הנחיה 6):
 * "השותף עונה מהנייד וסוגר."
 */
export default async function QuestionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period, division } = readGlobalParams(sp, new Date().toISOString())
  const who = typeof sp.who === 'string' && sp.who.startsWith('ask_') ? (sp.who as 'ask_nissim') : undefined
  const [rows, counts, categories, alerts] = await Promise.all([
    listQuestions(who), questionCounts(), listCategories(), activeAlertCount(),
  ])

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <HelpCircle size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">שאלות לשותפים</h1>
          <span className="text-xs text-text-3">התשובה נשמרת על התנועה עצמה — ומי שענה ומתי נשאר בהיסטוריה</span>
        </div>
        <QuestionsView rows={rows} counts={counts} categories={categories} who={who ?? null} />
      </main>
    </>
  )
}
