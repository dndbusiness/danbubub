import { CheckSquare } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { activeAlertCount } from '@/lib/queries/common'
import { listTasks, listUsers, taskCounts } from '@/lib/queries/tasks'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'
import { TasksView } from './client'

export const dynamic = 'force-dynamic'

/**
 * מסך 15 — תפעול ומשימות (ADDENDUM ב.10). מובייל-first (הנחיה 6).
 * "משימה אוטומטית נסגרת לבד כשהתנאי מפסיק להתקיים" — ולכן אי אפשר למחוק אותה ידנית.
 */
export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period, division } = readGlobalParams(sp, new Date().toISOString())
  const [tasks, counts, users, alerts] = await Promise.all([
    listTasks(), taskCounts(), listUsers(), activeAlertCount(),
  ])

  return (
    <>
      <Topbar period={period} division={division} alertCount={alerts} />
      <main className="p-4 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <CheckSquare size={20} className="text-text-2" />
          <h1 className="text-xl font-semibold">תפעול</h1>
          <span className="text-xs text-text-3">
            משימה אוטומטית נסגרת לבד כשהתנאי נפתר (ב.10) · כל מקור אוטומטי עם מפתח ייחודי, בלי כפילויות
          </span>
        </div>
        <TasksView tasks={tasks} counts={counts} users={users} />
      </main>
    </>
  )
}
