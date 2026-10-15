import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { gunzipSync } from 'node:zlib'
import { importMirror } from '@/lib/crm/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * שכפול: מקבל את קובץ הגיבוי של הדף ב-Claude (harel-crm-YYYY-MM-DD.json או .json.gz)
 * ומעדכן את המסמכים כאן. ריצה חוזרת על אותו קובץ = 0 שינויים (הנחיה 9).
 * אחרי המעבר נדחה (409) — ?force=1 לשחזור מכוון.
 */
export async function POST(req: Request) {
  { const s = await effectiveSession(req); if (s?.r !== 'owner') return NextResponse.json({ code: 'permission_denied', message: 'רק דן' }, { status: 403 }) }
  const buf = Buffer.from(await req.arrayBuffer())
  if (!buf.length) return NextResponse.json({ code: 'invalid_argument', message: 'לא התקבל קובץ' }, { status: 400 })
  let dump: unknown
  try { dump = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8')) }
  catch { return NextResponse.json({ code: 'invalid_argument', message: 'הקובץ לא JSON תקין (וגם לא gzip של JSON)' }, { status: 400 }) }
  const force = new URL(req.url).searchParams.get('force') === '1'
  try { return NextResponse.json(await importMirror(dump as never, { force })) }
  catch (e) {
    const live = (e as { code?: string }).code === 'failed_precondition'
    return NextResponse.json({ code: live ? 'failed_precondition' : 'invalid_argument', message: (e as Error).message }, { status: live ? 409 : 400 })
  }
}
