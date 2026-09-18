import { NextResponse, type NextRequest } from 'next/server'

/**
 * שער גישה זמני — **לא** מנגנון ההרשאות של SPEC §6 (שלב 10).
 * מטרה אחת: שהמערכת תוכל לעלות לאוויר בלי שכל מי שיש לו את הכתובת יראה את הכספים.
 * מופעל רק כשמוגדר APP_PASSWORD. אזורי ה-PIN (ניסים / שותפים / פרייבט) נשארים מעליו.
 *
 * מה זה לא נותן: אין משתמשים, אין תפקידים, אין תיעוד מי נכנס. זה מגיע בשלב 10.
 */
const COOKIE = 'harel_gate'
const OPEN_PATHS = ['/api/health', '/api/jobs', '/api/google/callback', '/gate']

export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD
  if (!password) return NextResponse.next()

  const { pathname, searchParams } = req.nextUrl
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next()

  const expected = tokenFor(password)
  if (req.cookies.get(COOKIE)?.value === expected) return NextResponse.next()

  // כניסה עם ?key= — לקישור מוואטסאפ/מייל; הקוקי נשמר ל-30 יום.
  if (searchParams.get('key') === password) {
    const url = req.nextUrl.clone()
    url.searchParams.delete('key')
    const res = NextResponse.redirect(url)
    res.cookies.set(COOKIE, expected, { httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 30 })
    return res
  }

  const gate = req.nextUrl.clone()
  gate.pathname = '/gate'
  gate.search = `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(gate)
}

/** לא שומרים את הסיסמה בקוקי — רק טוקן נגזר ממנה. */
function tokenFor(password: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < password.length; i++) { h ^= password.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36) + password.length.toString(36)
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
