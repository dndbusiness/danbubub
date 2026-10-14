import { NextResponse, type NextRequest } from 'next/server'
import { GATE_COOKIE, gateToken, sameToken } from '@/lib/gate'

/**
 * שער גישה זמני — **לא** מנגנון ההרשאות של SPEC §6 (שלב 10).
 * מטרה אחת: שהמערכת תוכל לעלות לאוויר בלי שכל מי שיש לו את הכתובת יראה את הכספים.
 * מופעל כשמוגדר APP_PASSWORD; בענן בלי סיסמה — הכל נעול (fail closed). אזורי ה-PIN (ניסים / שותפים / פרייבט) נשארים מעליו.
 *
 * מה זה לא נותן: אין משתמשים, אין תפקידים, אין תיעוד מי נכנס. זה מגיע בשלב 10.
 */
// המניפסט והאייקונים של ה-CRM נטענים בלי עוגיות (כך הדפדפן מבקש מניפסט) — אין בהם נתונים
// /s ו-/api/s — דף החתימה של הלקוח (הטוקן בקישור הוא ההרשאה; /s/print מוגן ב-HMAC)
const OPEN_PATHS = ['/api/health', '/api/jobs', '/api/google/callback', '/gate', '/s', '/api/s', '/crm-manifest.webmanifest', '/crm-icon.svg', '/crm-icon-192.png', '/crm-icon-512.png']

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD
  const { pathname, searchParams } = req.nextUrl
  if (!password) {
    // מקומי — פתוח (פיתוח). בענן (Vercel) בלי סיסמה — נעול: אחרת כל מי שיש לו את הכתובת קורא את הלקוחות דרך ה-API.
    if (!process.env.VERCEL || OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next()
    return new NextResponse('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font:16px/1.6 Heebo,Arial,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px;color:#111827;background:#F6F7F9">' +
      '<h1 style="font-size:22px">המערכת נעולה</h1><p>לא הוגדרה סיסמת כניסה, ולכן המערכת לא נפתחת ברשת.</p>' +
      '<p>ב-Vercel: Settings → Environment Variables → <b>APP_PASSWORD</b> (Production + Preview), ואז Redeploy.</p></body></html>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  }

  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next()

  const expected = await gateToken(password)
  if (sameToken(req.cookies.get(GATE_COOKIE)?.value, expected)) return NextResponse.next()

  // כניסה עם ?key= — לקישור מוואטסאפ/מייל ולשומר (scripts/crm-keeper.mjs); הקוקי נשמר ל-30 יום
  // והכתובת מנוקה מיד מהמפתח (redirect), כדי שלא יישאר בהיסטוריה.
  if (sameToken(searchParams.get('key'), password)) {
    const url = req.nextUrl.clone()
    url.searchParams.delete('key')
    const res = NextResponse.redirect(url)
    res.cookies.set(GATE_COOKIE, expected, { httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 30 })
    return res
  }

  const gate = req.nextUrl.clone()
  gate.pathname = '/gate'
  gate.search = `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(gate)
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
