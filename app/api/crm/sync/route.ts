import { NextResponse } from 'next/server'
import { changesSince } from '@/lib/crm/store'
import { canRead, crmSettings, effectiveSession, gateCookie, gatePassed, sanitizeSettings, sessionPerms } from '@/lib/crm/auth'

export const dynamic = 'force-dynamic'

/**
 * מה השתנה במסמכי ה-CRM אחרי seq — הדף מושך את זה כל כמה שניות (במקום האזנה בזמן אמת).
 * רק מה שהתפקיד של מי שנכנס רשאי לקרוא; לפני כניסה — ההגדרות בלבד (בלי גיבובי הסיסמאות), כדי שמסך הכניסה יעלה.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0)
  const colls = url.searchParams.get('colls')?.split(',').filter(Boolean) ?? null
  try {
    const s = await effectiveSession(req), gate = await gatePassed(req)
    /* לפני כניסה ובלי שער המשרד — מסך הכניסה צריך רק לדעת שיש סיסמה (lock בלי הגיבוב). שום דבר אחר מההגדרות.
       seq לא מתקדם; אחרי הכניסה הדף נטען מחדש ומקבל הכל */
    if (!s && !gate) {
      const lk = sanitizeSettings({ lock: (await crmSettings()).lock } as never) as { lock?: unknown }
      return NextResponse.json({ changes: lk.lock ? [{ coll: 'settings', id: 'main', seq: 0, data: { lock: lk.lock } }] : [], seq: after, more: false, session: null })
    }
    const all = await changesSince(after, colls)
    const perms = s ? sessionPerms(s, s.r === 'owner' ? null : await crmSettings()) : null
    const changes = all.filter((c) => canRead(s, c.coll, perms)).map((c) => (c.coll === 'settings' && c.data ? { ...c, data: sanitizeSettings(c.data) } : c))
    // seq מתקדם גם על מה שסונן — אחרת הדף היה מבקש אותו שוב ושוב
    const seq = all.at(-1)?.seq ?? after
    const res = NextResponse.json({ changes, seq, more: all.length >= 5000, session: s ? { key: s.k, role: s.r, divs: s.d, perms } : null })
    if (s && !gate) { const gc = await gateCookie(new URL(req.url).protocol === 'https:'); if (gc) res.headers.append('set-cookie', gc) }
    return res
  } catch (e) {
    return NextResponse.json({ code: 'unavailable', message: (e as Error).message }, { status: 503 })
  }
}
