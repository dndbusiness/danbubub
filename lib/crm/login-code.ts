/**
 * כניסה בקוד חד-פעמי (דן, 19/10: "זיהוי מהנייד או מהמייל שיהיה קל להתחבר, מחובר 14 יום").
 * הקוד נשלח דרך outbox (הנחיה 16) — וואטסאפ אם יש טלפון ו-Green API, ומייל דרך גוגל.
 * נשמר רק גיבוב של הקוד, באוסף loginCodes שלא יוצא לדפדפן (SERVER_ONLY).
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { sql } from '@/lib/db'
import { codeLoginFor, crmSettings, normUserKey, type CrmSession } from '@/lib/crm/auth'
import { writeDoc } from '@/lib/crm/store'
import { enqueueOutbox, flushOutbox } from '@/lib/jobs/outbox'
import { greenApiConfig } from '@/lib/outbox/green-api'
import { googleIntegration, hasScope } from '@/lib/google/store'
import { maskEmail, maskPhone, OTP_MAX_ATTEMPTS, OTP_RESEND_MS, OTP_TTL_MS, waTarget } from '@/lib/rules/sign'

interface CodeDoc { hash: string; salt: string; exp: number; sentAt: number; tries: number; used?: boolean }

const docId = (username: string) => 'c-' + (normUserKey(username) || 'dan').replace(/[^\w֐-׿.-]/g, '_').slice(0, 80)
const hashOf = (salt: string, code: string) => createHash('sha256').update(`login:${salt}:${code}`).digest('hex')

async function current(id: string): Promise<CodeDoc | null> {
  const [r] = await sql<{ data: CodeDoc }[]>`select data from crm_docs where coll = 'loginCodes' and doc_id = ${id} and deleted_at is null`
  return r?.data ?? null
}

export type SendResult = { ok: true; to: string[] } | { ok: false; error: string }

export async function sendLoginCode(username: string, now = Date.now()): Promise<SendResult> {
  const who = codeLoginFor(await crmSettings(), username, now)
  // אותה תשובה כמו לשליחה — לא מגלים מי קיים במערכת
  if (!who) return { ok: false, error: 'אין משתמש כזה, או שעוד לא הוגדרה לו סיסמה' }
  const id = docId(username), prev = await current(id)
  if (prev && !prev.used && now - prev.sentAt < OTP_RESEND_MS) return { ok: false, error: 'קוד נשלח לפני פחות מדקה — בדקו את הוואטסאפ ואת המייל (גם בספאם)' }
  const wa = !!greenApiConfig() && !!waTarget(who.phone)
  const google = await googleIntegration().catch(() => null)
  const mail = !!who.email && hasScope(google, 'https://www.googleapis.com/auth/gmail.send')
  if (!wa && !mail) return { ok: false, error: 'אין עדיין דרך לשלוח קוד (וואטסאפ או מייל לא מחוברים) — היכנסו בסיסמה' }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), salt = randomBytes(16).toString('hex')
  await writeDoc('loginCodes/' + id, 'set', { hash: hashOf(salt, code), salt, exp: now + OTP_TTL_MS, sentAt: now, tries: 0 } satisfies CodeDoc)
  const key = `login-code:${id}:${now}`, to: string[] = []
  const rows = []
  if (wa) { rows.push({ channel: 'whatsapp' as const, target: waTarget(who.phone)!, subject: 'קוד כניסה', body: `קוד הכניסה למערכת הר-אל: ${code}\nבתוקף 10 דקות. אם לא ביקשת — אפשר להתעלם.`, dedupKey: key + ':wa' }); to.push('וואטסאפ ' + maskPhone(who.phone)) }
  if (mail) { rows.push({ channel: 'email' as const, target: who.email!, subject: `קוד כניסה להר-אל: ${code}`, body: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#111827"><p>קוד הכניסה למערכת הר-אל (${escHtml(who.session.l)}):</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p style="color:#6B7280;font-size:13px">הקוד בתוקף 10 דקות. אם לא ביקשת — אפשר להתעלם.</p></div>`, dedupKey: key + ':mail' }); to.push(maskEmail(who.email)) }
  await enqueueOutbox(rows)
  await flushOutbox().catch((e) => console.error('outbox:', (e as Error).message))
  return { ok: true, to }
}

export async function verifyLoginCode(username: string, code: string, now = Date.now()): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const who = codeLoginFor(await crmSettings(), username, now)
  const id = docId(username), c = await current(id)
  if (!who || !c || c.used) return { ok: false, error: 'בקשו קוד חדש' }
  if (now > c.exp) return { ok: false, error: 'הקוד פג — בקשו קוד חדש' }
  if (c.tries >= OTP_MAX_ATTEMPTS) return { ok: false, error: 'יותר מדי ניסיונות — בקשו קוד חדש' }
  const a = Buffer.from(hashOf(c.salt, String(code).replace(/\D/g, ''))), b = Buffer.from(c.hash)
  if (!(a.length === b.length && timingSafeEqual(a, b))) {
    await writeDoc('loginCodes/' + id, 'update', { tries: c.tries + 1 })
    return { ok: false, error: 'קוד שגוי' }
  }
  await writeDoc('loginCodes/' + id, 'update', { used: true })
  return { ok: true, session: who.session }
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
