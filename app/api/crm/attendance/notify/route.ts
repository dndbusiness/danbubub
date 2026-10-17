import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { attendanceNotify } from '@/lib/jobs/attendance-watch'

export const dynamic = 'force-dynamic'

/** האטה פשוטה לכל משתמש (בזיכרון התהליך): 20 בקשות ב-10 דקות מספיקות לשעון שבודק כל 5 דקות */
const hits = new Map<string, number[]>()
function limited(k: string, now = Date.now()): boolean {
  const arr = (hits.get(k) ?? []).filter((t) => now - t < 10 * 60e3)
  if (arr.length >= 20) { hits.set(k, arr); return true }
  arr.push(now); hits.set(k, arr); return false
}

/**
 * התראת נוכחות למנהל — וואטסאפ + מייל דרך תיבת היוצא בשרת (הנחיה 16). idempotent לפי rule_key
 * (att_away / att_idle — אותו מפתח כמו בג'וב attendance_watch), כך שקריאה חוזרת לא שולחת שוב.
 * רק העובד עצמו (או מנהל) מבקש, והשרת בודק במסמך שהמצב באמת מצדיק התראה.
 */
export async function POST(req: Request) {
  let body: { kind?: string; key?: string; date?: string }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  const { kind, key, date } = body
  if ((kind !== 'away' && kind !== 'idle') || !key || !/^[\w.-]{1,64}$/.test(key) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ code: 'invalid_argument', message: 'חסר kind / key / date' }, { status: 400 })
  const s = await effectiveSession(req)
  if (!s) return NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  if (s.k !== key && !['owner', 'admin', 'admin_re'].includes(s.r)) return NextResponse.json({ code: 'permission_denied', message: 'רק העובד עצמו או מנהל' }, { status: 403 })
  if (limited(s.k)) return NextResponse.json({ code: 'rate_limited', message: 'יותר מדי בקשות' }, { status: 429 })
  try {
    const r = await attendanceNotify(key, date, kind)
    return NextResponse.json(r, { status: r.ok ? 200 : 409 })
  } catch (e) {
    return NextResponse.json({ code: 'upstream_error', message: (e as Error).message }, { status: 500 })
  }
}
