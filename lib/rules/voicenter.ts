/**
 * וויאסנטר — חיוג מהמערכת (click2call) ומיפוי שלוחה → עובד. פונקציות טהורות; הקריאה עצמה ב-app/api/crm/call.
 * click2call: המרכזייה מצלצלת קודם לשלוחה של העובד, וכשהוא עונה — מחייגת ללקוח.
 * https://api.voicenter.com/ForwardDialer/click2call.aspx?phone=<שלוחה>&target=<לקוח>&code=<קוד החשבון>&action=call
 */
export const CLICK2CALL_URL = 'https://api.voicenter.com/ForwardDialer/click2call.aspx'

interface UserRec { username?: string; resp?: string; ext?: string }
interface VcSettings { users?: UserRec[]; ownerExt?: string; voicenterReps?: Record<string, string> }

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()
const userKey = (u: UserRec) => u.resp || norm(u.username)

/** שלוחה → מפתח עובד: מהשדה "שלוחה" במשתמשים + השלוחה של דן; מיפוי ידני (voicenterReps) גובר */
export function repMap(s: VcSettings): Record<string, string> {
  const out: Record<string, string> = {}
  if (norm(s.ownerExt)) out[norm(s.ownerExt)] = 'dan'
  for (const u of s.users ?? []) if (norm(u.ext) && userKey(u)) out[norm(u.ext)] = userKey(u)
  for (const [k, v] of Object.entries(s.voicenterReps ?? {})) if (norm(k) && v) out[norm(k)] = v
  return out
}

/** השלוחה של מי שנכנס */
export function extOf(s: VcSettings, key: string): string | null {
  if (key === 'dan') return norm(s.ownerExt) || null
  const u = (s.users ?? []).find((x) => userKey(x) === key)
  return (u && norm(u.ext)) || null
}

/** מספר ישראלי לחיוג: ספרות בלבד, 972 → 0 */
export function dialable(phone: unknown): string | null {
  let d = String(phone ?? '').replace(/\D/g, '')
  if (d.startsWith('972')) d = '0' + d.slice(3)
  return d.length >= 9 && d.length <= 11 ? d : null
}

export function click2callUrl(code: string, ext: string, target: string): string {
  const q = new URLSearchParams({ phone: ext, target, code, action: 'call' })
  return CLICK2CALL_URL + '?' + q.toString()
}

/** תשובת וויאסנטר (XML כברירת מחדל, או JSON): הצלחה = אין שגיאה מפורשת */
export function click2callOk(status: number, text: string): { ok: boolean; message: string } {
  const t = String(text || '')
  if (status < 200 || status >= 300) return { ok: false, message: 'המרכזייה החזירה ' + status }
  const err = t.match(/<(?:ERROR|Error|ErrorMessage|ERRORMESSAGE)>([^<]+)</)?.[1] || (/"(?:error|Error|ERROR)"\s*:\s*"([^"]+)"/.exec(t) || [])[1]
  const code = t.match(/<(?:ERRORCODE|ErrorCode|STATUS|Status)>\s*(-?\d+)\s*</)?.[1] ?? (/"(?:ERRORCODE|ErrorCode|status|Status)"\s*:\s*"?(-?\d+)/.exec(t) || [])[1]
  if (err && err.trim()) return { ok: false, message: err.trim() }
  if (code != null && Number(code) !== 0 && Number(code) !== 1) return { ok: false, message: 'קוד שגיאה מהמרכזייה: ' + code }
  return { ok: true, message: '' }
}
