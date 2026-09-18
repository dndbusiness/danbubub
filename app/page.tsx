import Link from 'next/link'
import { Topbar } from '@/components/shell/topbar'
import { Card } from '@/components/ui/card'
import { NAV } from '@/components/shell/nav-items'
import { readGlobalParams, type SearchParams } from '@/lib/ui/params'

/**
 * דף הבית הזמני. מסך 21 "מצב החברה" (ADDENDUM ב.8) נבנה בשלב מאוחר יותר —
 * עד אז זה מפת המסכים, בלי מספרים (SPEC §5: אין מספר בלי drill-down).
 */
export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { period, division } = readGlobalParams(sp, new Date().toISOString())
  const items = NAV.filter((n): n is Exclude<typeof n, 'divider'> => n !== 'divider')

  return (
    <>
      <Topbar period={period} division={division} />
      <main className="p-4 md:p-6 flex flex-col gap-4">
        <h1 className="text-xl font-semibold">מסכי המערכת</h1>
        <p className="text-sm text-text-2">
          מסך "מצב החברה" ייבנה בשלב מאוחר יותר. בשלב 2 בנויים: תיקים, תנועות, הוצאות קבועות.
        </p>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((n) => (
            <Link key={n.href} href={n.built ? n.href : '#'} prefetch={n.built ? undefined : false} aria-disabled={!n.built}>
              <Card className={n.built ? 'hover:shadow-md transition-shadow' : 'opacity-50'}>
                <div className="flex items-center gap-3">
                  <n.icon size={20} className="text-text-2" />
                  <div>
                    <div className="font-medium">{n.label}</div>
                    <div className="text-xs text-text-3">מסך {n.screen}{n.built ? '' : ' · בקרוב'}</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </>
  )
}
