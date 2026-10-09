import { NextResponse } from 'next/server'
import { gunzipSync } from 'node:zlib'
import { importMirror } from '@/lib/crm/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * שכפול: מקבל את קובץ הגיבוי של הדף ב-Claude (harel-crm-YYYY-MM-DD.json או .json.gz)
 * ומעדכן את המסמכים כאן. ריצה חוזרת על אותו קובץ = 0 שינויים (הנחיה 9).
 */
export async function POST(req: Request) {
  const buf = Buffer.from(await req.arrayBuffer())
  if (!buf.length) return NextResponse.json({ code: 'invalid_argument', message: 'לא התקבל קובץ' }, { status: 400 })
  let dump: unknown
  try { dump = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8')) }
  catch { return NextResponse.json({ code: 'invalid_argument', message: 'הקובץ לא JSON תקין (וגם לא gzip של JSON)' }, { status: 400 }) }
  try { return NextResponse.json(await importMirror(dump as never)) }
  catch (e) { return NextResponse.json({ code: 'invalid_argument', message: (e as Error).message }, { status: 400 }) }
}
