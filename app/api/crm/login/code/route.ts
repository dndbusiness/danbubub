import { NextResponse } from 'next/server'
import { sessionCookie, throttle } from '@/lib/crm/auth'
import { ensureMember } from '@/lib/crm/store'
import { sendLoginCode, verifyLoginCode } from '@/lib/crm/login-code'

export const dynamic = 'force-dynamic'

/**
 * כניסה בקוד: { action: 'send', username } שולח קוד לוואטסאפ / למייל; { action: 'verify', username, code } מכניס
 * (אותה עוגייה כמו כניסה בסיסמה — 14 יום). דן = שם משתמש ריק.
 */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'local'
  const wait = throttle(ip)
  if (wait) return NextResponse.json({ code: 'rate_limited', message: `יותר מדי ניסיונות — נסו בעוד ${wait} שניות` }, { status: 429 })
  let body: { action?: string; username?: string; code?: string }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  const username = String(body.username ?? '')
  try {
    if (body.action === 'send') {
      const r = await sendLoginCode(username)
      return r.ok ? NextResponse.json({ ok: true, to: r.to }) : NextResponse.json({ code: 'failed_precondition', message: r.error }, { status: 412 })
    }
    if (body.action !== 'verify') return NextResponse.json({ code: 'invalid_argument', message: 'פעולה לא מוכרת' }, { status: 400 })
    const r = await verifyLoginCode(username, String(body.code ?? ''))
    throttle(ip, r.ok)
    if (!r.ok) return NextResponse.json({ code: 'unauthenticated', message: r.error }, { status: 401 })
    await ensureMember(r.session).catch(() => {})
    const res = NextResponse.json({ key: r.session.k, role: r.session.r, divs: r.session.d, label: r.session.l })
    res.headers.append('set-cookie', sessionCookie(r.session, new URL(req.url).protocol === 'https:'))
    return res
  } catch (e) {
    return NextResponse.json({ code: 'unavailable', message: 'השרת לא זמין כרגע — נסו שוב בעוד רגע (' + (e as Error).message + ')' }, { status: 503 })
  }
}
