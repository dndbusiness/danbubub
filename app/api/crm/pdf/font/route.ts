import { NextResponse } from 'next/server'
import { readFallbackFont } from '@/lib/pdfedit/engine'
import { fileOfKey } from '@/lib/rules/pdf-edit'
import { guard } from '@/lib/pdfedit/http'

export const dynamic = 'force-dynamic'

/**
 * GET ?k=sans-bold — הגופן שבו העורך מציג טקסט בזמן עריכה (@font-face), אותו גופן שייכתב לקובץ כשהמקורי חסר אותיות.
 * Liberation (OFL): אותם מדדים כמו Arial / Times / Courier, כולל עברית. גופני subset מתוך ה-PDF לא מוגשים —
 * אין בהם מיפוי תווים, אז הדפדפן לא יכול להקליד בהם.
 */
export async function GET(req: Request) {
  const g = await guard(req); if (g) return g
  const file = fileOfKey(String(new URL(req.url).searchParams.get('k') ?? ''))
  if (!file) return NextResponse.json({ code: 'invalid_argument', message: 'גופן לא מוכר' }, { status: 400 })
  const buf = await readFallbackFont(file)
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'font/ttf', 'cache-control': 'private, max-age=604800, immutable' } })
}
