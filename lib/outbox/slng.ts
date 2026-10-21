/**
 * SLNG — SMS ללקוח (דן, 21/10). רק התחבורה; התור, ה-retry והלוג ב-lib/jobs/outbox.ts (הנחיה 16).
 * רישום לטופס של SLNG מכניס את הלקוח לקבוצה, ומענה אוטומטי שם שולח את ה-SMS מהמספר של המשרד.
 * כתובת הטופס ושמות השדות — רק בסביבת השרת (הכתובת מאפשרת לשלוח SMS על חשבון המשרד).
 */
import { ilMobile, firstName } from '@/lib/rules/sms'

export interface SlngConfig { url: string; fName: string; fPhone: string; fLink: string }
export interface SmsPayload { name: string; phone: string; link: string }

export function slngConfig(env: Record<string, string | undefined> = process.env): SlngConfig | null {
  const { SLNG_FORM_URL: url, SLNG_FIELD_NAME: fName, SLNG_FIELD_PHONE: fPhone, SLNG_FIELD_LINK: fLink } = env
  // https בלבד; http רק לשרת מקומי (בדיקות)
  if (!url || !fName || !fPhone || !fLink || !/^(?:https:\/\/|http:\/\/(?:127\.0\.0\.1|localhost)[:/])/.test(url)) return null
  return { url, fName, fPhone, fLink }
}

/** רישום אחד ל-SLNG (multipart). 200 = הצליח; כל דבר אחר זורק — ה-retry ב-flushOutbox. */
export async function sendSlng(cfg: SlngConfig, p: SmsPayload, fetchImpl: typeof fetch = fetch): Promise<string> {
  const phone = ilMobile(p.phone)
  if (!phone) throw new Error('מספר נייד לא תקין')
  const fd = new FormData()
  fd.append(cfg.fName, firstName(p.name)); fd.append(cfg.fPhone, phone); fd.append(cfg.fLink, p.link)
  const res = await fetchImpl(cfg.url, { method: 'POST', body: fd })
  if (res.status !== 200) throw new Error(`SLNG ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`)
  return 'slng:200'
}
