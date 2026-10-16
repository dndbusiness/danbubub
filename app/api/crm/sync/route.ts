import { NextResponse } from 'next/server'
import { changesSince } from '@/lib/crm/store'
import { canRead, crmSettings, effectiveSession, sanitizeSettings, sessionPerms } from '@/lib/crm/auth'

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
    const s = await effectiveSession(req)
    const all = await changesSince(after, colls)
    const perms = s ? sessionPerms(s, s.r === 'owner' ? null : await crmSettings()) : null
    const changes = all.filter((c) => canRead(s, c.coll, perms)).map((c) => (c.coll === 'settings' && c.data ? { ...c, data: sanitizeSettings(c.data) } : c))
    // seq מתקדם גם על מה שסונן — אחרת הדף היה מבקש אותו שוב ושוב
    const seq = all.at(-1)?.seq ?? after
    return NextResponse.json({ changes, seq, more: all.length >= 5000, session: s ? { key: s.k, role: s.r, divs: s.d, perms } : null })
  } catch (e) {
    return NextResponse.json({ code: 'unavailable', message: (e as Error).message }, { status: 503 })
  }
}
