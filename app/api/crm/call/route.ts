import { NextResponse } from 'next/server'
import { crmSettings, effectiveSession } from '@/lib/crm/auth'
import { click2callOk, click2callUrl, dialable, extOf } from '@/lib/rules/voicenter'

export const dynamic = 'force-dynamic'

/**
 * חיוג מהמערכת דרך וויאסנטר (דן, 20/10: "אופציה ישירה לשיחה עם הלקוח").
 * GET → האם פעיל למי שנכנס (יש VOICENTER_CODE ושלוחה בהגדרות). POST { phone } → המרכזייה מצלצלת לשלוחה, ואז ללקוח.
 * השיחה עצמה נרשמת בליד מה-CDR (app/api/crm/inbound/voicenter), כמו כל שיחה.
 */
export async function GET(req: Request) {
  const s = await effectiveSession(req)
  if (!s || !process.env.VOICENTER_CODE) return NextResponse.json({ enabled: false })
  const ext = extOf(await crmSettings() as never, s.k)
  return NextResponse.json({ enabled: !!ext, ext })
}

export async function POST(req: Request) {
  const s = await effectiveSession(req)
  if (!s) return NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  const code = process.env.VOICENTER_CODE
  if (!code) return NextResponse.json({ code: 'failed_precondition', message: 'המרכזייה לא מחוברת (חסר קוד וויאסנטר בשרת)' }, { status: 412 })
  let body: { phone?: string }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  const target = dialable(body.phone)
  if (!target) return NextResponse.json({ code: 'invalid_argument', message: 'מספר טלפון לא תקין' }, { status: 400 })
  const ext = extOf(await crmSettings() as never, s.k)
  if (!ext) return NextResponse.json({ code: 'failed_precondition', message: 'אין לך שלוחה בהגדרות (הגדרות ← משתמשים ← שלוחה במרכזייה)' }, { status: 412 })
  try {
    const r = await fetch(click2callUrl(code, ext, target), { signal: AbortSignal.timeout(15000) })
    const res = click2callOk(r.status, await r.text())
    return res.ok ? NextResponse.json({ ok: true, ext }) : NextResponse.json({ code: 'upstream_error', message: res.message }, { status: 502 })
  } catch (e) {
    return NextResponse.json({ code: 'unavailable', message: 'המרכזייה לא ענתה: ' + (e as Error).message }, { status: 503 })
  }
}
