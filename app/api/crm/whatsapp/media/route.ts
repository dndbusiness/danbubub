import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { waConfig } from '@/lib/rules/wa-cloud'

export const dynamic = 'force-dynamic'

/** קובץ שהלקוח שלח (תמונה / מסמך / הקלטה) — Meta שומרת אותו 30 יום; כאן מורידים עם הטוקן של השרת. ?id=<media id> */
export async function GET(req: Request) {
  const s = await effectiveSession(req); if (!s) return NextResponse.json({ error: 'צריך להיכנס' }, { status: 401 })
  const cfg = waConfig(), id = new URL(req.url).searchParams.get('id') || ''
  if (!cfg || !/^\d{5,30}$/.test(id)) return NextResponse.json({ error: 'לא זמין' }, { status: 400 })
  const m = await fetch(`${cfg.base}/${cfg.version}/${id}`, { headers: { authorization: 'Bearer ' + cfg.token } }).then((r) => r.json()).catch(() => null) as { url?: string; mime_type?: string } | null
  if (!m?.url) return NextResponse.json({ error: 'הקובץ כבר לא זמין ב-Meta (נשמר 30 יום)' }, { status: 404 })
  const f = await fetch(m.url, { headers: { authorization: 'Bearer ' + cfg.token } })
  if (!f.ok) return NextResponse.json({ error: 'ההורדה נכשלה' }, { status: 502 })
  return new NextResponse(f.body, { headers: { 'content-type': m.mime_type || f.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'private, max-age=3600' } })
}
