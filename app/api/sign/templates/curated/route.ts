import { NextResponse } from 'next/server'
import { applyCurated } from '@/lib/sign/templates'
import { curatedCount } from '@/lib/sign/curated'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * שדות מוכנים לטפסים שכבר בספרייה (data/sign-forms, דן 21/10).
 *   GET              → כמה טפסים מוכנים יש
 *   POST {ids: []}   → לכל תבנית ברשימה שהקובץ שלה הוא טופס מוכן — השדות מוחלפים בשדות שנבדקו
 */
export async function GET() {
  return NextResponse.json({ forms: curatedCount() })
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { ids?: unknown } | null
  const ids = Array.isArray(b?.ids) ? b!.ids.map(String) : []
  return NextResponse.json(await applyCurated(ids))
}
