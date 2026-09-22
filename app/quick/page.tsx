import Link from 'next/link'
import { Anchor, Briefcase, HandCoins, Receipt } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import { Card } from '@/components/ui/card'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'

export const dynamic = 'force-dynamic'

/** ➕ בניווט התחתון — UIUX §3.2 / §6: הזרימות הקריטיות בנייד, כל אחת ≤3 טאפים. */
export default async function QuickPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period, division } = readGlobalParams(sp, new Date().toISOString())
  const items = [
    { href: '/anchor', label: 'עוגן יומי', hint: 'יתרה + מסגרת, שמור', icon: Anchor },
    { href: '/deals?quick=expense', label: 'הוצאה ישירה לתיק', hint: 'תיק, סכום, שמור', icon: Briefcase },
    { href: '/nissim?quick=advance', label: 'מקדמה לניסים', hint: 'סכום, אמצעי, שמור', icon: HandCoins },
    { href: '/transactions?quick=new', label: 'תנועה חדשה', hint: 'הטופס המלא', icon: Receipt },
  ]
  return (
    <>
      <Topbar period={period} division={division} />
      <main className="p-4 md:p-6 flex flex-col gap-3 max-w-xl">
        <h1 className="text-xl font-semibold">הזנה מהירה</h1>
        {items.map((i) => (
          <Link key={i.href} href={i.href} prefetch={false}>
            <Card className="flex items-center gap-4 min-h-[72px] hover:shadow-md transition-shadow">
              <i.icon size={24} className="text-brand" />
              <div><div className="font-medium text-base">{i.label}</div><div className="text-xs text-text-3">{i.hint}</div></div>
            </Card>
          </Link>
        ))}
      </main>
    </>
  )
}
