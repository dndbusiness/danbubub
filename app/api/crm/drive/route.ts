import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { googleAccessToken } from '@/lib/google/store'
import { DriveDirectError, fileStream, uploadSession } from '@/lib/crm/drive-direct'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** קבצי דרייב בלי מגבלת 4.5MB של Vercel — ראו lib/crm/drive-direct.ts. אותו חיבור גוגל כמו /api/crm/mcp. */
async function token(): Promise<string | NextResponse> {
  try { return await googleAccessToken() } catch (e) { return NextResponse.json({ code: 'server_not_connected', message: (e as Error).message }, { status: 409 }) }
}
const errOut = (e: unknown) => {
  const code = e instanceof DriveDirectError ? e.code : 'upstream_error'
  return NextResponse.json({ code, message: (e as Error).message }, { status: code === 'not_granted' ? 403 : code === 'not_found' ? 404 : code === 'invalid_argument' ? 400 : 502 })
}

/** GET ?id=<fileId>[&export=<mime>] — הקובץ עצמו (זרם) */
export async function GET(req: Request) {
  if (!(await effectiveSession(req))) return NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  const u = new URL(req.url), t = await token(); if (typeof t !== 'string') return t
  try {
    const f = await fileStream(t, String(u.searchParams.get('id') ?? ''), u.searchParams.get('export'))
    return new Response(f.body, { headers: { 'content-type': f.mimeType, 'cache-control': 'private, no-store', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` } })
  } catch (e) { return errOut(e) }
}

/** POST { title, mimeType, parentId, size } → { url } — כתובת העלאה; הדפדפן שולח אליה את הקובץ ב-PUT */
export async function POST(req: Request) {
  if (!(await effectiveSession(req))) return NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  let body: { title?: string; mimeType?: string; parentId?: string; size?: number }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  const t = await token(); if (typeof t !== 'string') return t
  try {
    const origin = req.headers.get('origin') || process.env.APP_BASE_URL?.replace(/\/+$/, '') || null
    return NextResponse.json({ url: await uploadSession(t, { title: String(body.title ?? ''), mimeType: body.mimeType, parentId: body.parentId ?? null, size: Number(body.size) || undefined }, origin) })
  } catch (e) { return errOut(e) }
}
