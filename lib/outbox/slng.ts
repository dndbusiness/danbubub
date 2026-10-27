/**
 * SLNG — SMS ללקוח (דן, 21/10). רק התחבורה; התור, ה-retry והלוג ב-lib/jobs/outbox.ts (הנחיה 16).
 * שני מצבים:
 *   api  (דן 27/10, "API_UserGuide" של SLNG, §2): POST JSON ל-SendSmsJsonBody.ashx עם שם משתמש + סיסמת API + שולח.
 *        הנוסח נבנה כאן (smsText) — אותו נוסח כמו המענה האוטומטי בקבוצה ב-SLNG.
 *   form (21/10): רישום לטופס של SLNG; מענה אוטומטי שם שולח את ה-SMS. נשאר לגיבוי כשאין פרטי API.
 * הפרטים — רק בסביבת השרת (שולחים SMS על חשבון המשרד). לא בקוד ולא בצ׳אט.
 */
import { ilMobile, firstName, smsText } from '@/lib/rules/sms'

export type SlngConfig =
  | { mode: 'api'; url: string; user: string; password: string; from: string }
  | { mode: 'form'; url: string; fName: string; fPhone: string; fLink: string }
export interface SmsPayload { name: string; phone: string; link: string }

export const SLNG_API_URL = 'https://slng5.com/Api/SendSmsJsonBody.ashx'
// https בלבד; http רק לשרת מקומי (בדיקות)
const safeUrl = (u: string) => /^(?:https:\/\/|http:\/\/(?:127\.0\.0\.1|localhost)[:/])/.test(u)

export function slngConfig(env: Record<string, string | undefined> = process.env): SlngConfig | null {
  const { SLNG_API_USER: user, SLNG_API_PASSWORD: password, SLNG_FROM: from, SLNG_API_URL: apiUrl } = env
  // שולח: מספר טלפון, או עד 12 תווים באנגלית (§2.3)
  if (user && password && from && (/^0\d{8,9}$/.test(from) || /^[A-Za-z0-9 ._-]{1,12}$/.test(from))) {
    const url = apiUrl || SLNG_API_URL
    if (safeUrl(url)) return { mode: 'api', url, user, password, from }
  }
  const { SLNG_FORM_URL: url, SLNG_FIELD_NAME: fName, SLNG_FIELD_PHONE: fPhone, SLNG_FIELD_LINK: fLink } = env
  if (!url || !fName || !fPhone || !fLink || !safeUrl(url)) return null
  return { mode: 'form', url, fName, fPhone, fLink }
}

/** התשובה של SLNG: {"Status":true,"Description":…,"GeneralGUID":…} — לפעמים מקודדת ב-URL (כמו בדוגמת ה-PHP במדריך) */
export function parseSlngReply(text: string): { ok: boolean; description: string; guid: string | null } {
  let j: { Status?: unknown; Description?: unknown; GeneralGUID?: unknown } | null = null
  for (const t of [text, (() => { try { return decodeURIComponent(text.replace(/\+/g, ' ')) } catch { return '' } })()]) { try { j = JSON.parse(t); break } catch { /* הבא */ } }
  if (!j || typeof j !== 'object') return { ok: false, description: 'תשובה לא מוכרת: ' + text.slice(0, 120), guid: null }
  return { ok: j.Status === true || String(j.Status).toLowerCase() === 'true', description: String(j.Description ?? ''), guid: j.GeneralGUID ? String(j.GeneralGUID) : null }
}

/** שליחה אחת. הצלחה = מזהה; כל כישלון זורק — ה-retry ב-flushOutbox. */
export async function sendSlng(cfg: SlngConfig, p: SmsPayload, fetchImpl: typeof fetch = fetch): Promise<string> {
  const phone = ilMobile(p.phone)
  if (!phone) throw new Error('מספר נייד לא תקין')
  if (cfg.mode === 'api') {
    const body = { Username: cfg.user, Password: cfg.password, MsgName: 'הר-אל · מסמך לחתימה', MsgBody: smsText(p.name, p.link), FromMobile: cfg.from, DeliveryAckUrl: null, MsgScheduleTime: null, Mobiles: [{ Mobile: phone, AckID: null }] }
    const res = await fetchImpl(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) })
    const text = await res.text().catch(() => '')
    if (res.status !== 200) throw new Error(`SLNG ${res.status}: ${text.slice(0, 160)}`)
    const r = parseSlngReply(text)
    if (!r.ok) throw new Error('SLNG: ' + (r.description || 'נדחה'))
    return 'slng:' + (r.guid || 'ok')
  }
  const fd = new FormData()
  fd.append(cfg.fName, firstName(p.name)); fd.append(cfg.fPhone, phone); fd.append(cfg.fLink, p.link)
  const res = await fetchImpl(cfg.url, { method: 'POST', body: fd })
  if (res.status !== 200) throw new Error(`SLNG ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`)
  return 'slng:200'
}
