import { NextResponse } from 'next/server'
import { crmSettings, lockConfigured, sessionCookie, throttle, verifyLogin } from '@/lib/crm/auth'

export const dynamic = 'force-dynamic'

/**
 * כניסה אישית: שם משתמש + סיסמה (או רק סיסמה — דן). הבדיקה כאן, מול הגיבובים השמורים,
 * והתשובה היא עוגייה חתומה. הסיסמה לא נשמרת ולא נכתבת ללוג.
 */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'local'
  const wait = throttle(ip)
  if (wait) return NextResponse.json({ code: 'rate_limited', message: `יותר מדי ניסיונות — נסו בעוד ${wait} שניות` }, { status: 429 })
  let body: { username?: string; password?: string }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  const settings = await crmSettings()
  if (!lockConfigured(settings) && !body.username) return NextResponse.json({ code: 'failed_precondition', message: 'עוד לא הוגדרה סיסמה' }, { status: 412 })
  const s = verifyLogin(settings, String(body.username ?? ''), String(body.password ?? ''))
  throttle(ip, !!s)
  if (!s) return NextResponse.json({ code: 'unauthenticated', message: 'שם משתמש או סיסמה שגויים' }, { status: 401 })
  const res = NextResponse.json({ key: s.k, role: s.r, divs: s.d, label: s.l })
  res.headers.append('set-cookie', sessionCookie(s, new URL(req.url).protocol === 'https:'))
  return res
}

/** יציאה — מוחק את עוגיית הכניסה האישית (שער המשרד נשאר) */
export async function DELETE(req: Request) {
  const res = NextResponse.json({ ok: true })
  res.headers.append('set-cookie', sessionCookie(null, new URL(req.url).protocol === 'https:'))
  return res
}
