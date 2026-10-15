import { NextResponse } from 'next/server'
import { writeDoc, type WriteOp } from '@/lib/crm/store'
import { parsePath } from '@/lib/crm/docs.js'
import { canWrite, crmSettings, effectiveSession, guardPerms, restoreSecrets, sessionPerms } from '@/lib/crm/auth'

export const dynamic = 'force-dynamic'

/** כתיבת מסמך CRM: set / update / delete (מחיקה = deleted_at, הנחיה 4). רק מה שהתפקיד רשאי לכתוב. */
export async function POST(req: Request) {
  let body: { path?: string; op?: WriteOp; data?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  if (!body.path || !['set', 'update', 'delete'].includes(String(body.op))) return NextResponse.json({ code: 'invalid_argument', message: 'חסר path או op' }, { status: 400 })
  const p = parsePath(body.path)
  if (!p) return NextResponse.json({ code: 'invalid_argument', message: 'נתיב לא חוקי' }, { status: 400 })
  const s = await effectiveSession(req)
  const stored = s && s.r !== 'owner' ? await crmSettings() : null
  if (!canWrite(s, p[0], s ? sessionPerms(s, stored) : null)) return NextResponse.json({ code: s ? 'permission_denied' : 'unauthenticated', message: s ? 'אין הרשאה לכתוב כאן' : 'צריך להיכנס' }, { status: s ? 403 : 401 })
  let data = body.data
  // הגיבובים לא יצאו לדפדפן — מחזירים אותם לפני השמירה, כדי שכתיבה של ההגדרות לא תמחק סיסמאות
  if (p[0] === 'settings' && p[1] === 'main' && data && typeof data === 'object') {
    if (s!.r === 'center') return NextResponse.json({ code: 'permission_denied', message: 'אין הרשאה לשנות הגדרות' }, { status: 403 })
    const cur = stored ?? await crmSettings()
    data = guardPerms(restoreSecrets(data as Record<string, unknown>, cur), cur, s!)
  }
  try {
    const r = await writeDoc(body.path, body.op as WriteOp, data)
    return NextResponse.json(r)
  } catch (e) {
    const code = (e as { code?: string }).code
    return NextResponse.json({ code: code === 'invalid_argument' ? code : 'upstream_error', message: (e as Error).message }, { status: code === 'invalid_argument' ? 400 : 500 })
  }
}
