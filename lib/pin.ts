/**
 * PIN לאזורים מוגנים (SPEC §6) — הצד שבשרת. הפתיחה היא עוגייה חתומה לעשר דקות, והדף טוען את
 * הנתונים רק כשהיא תקפה: מה שלא נפתח לא יוצא מהשרת בכלל (לא רק מטושטש במסך).
 *
 * מפתח החתימה = ה-hash השמור של ה-PIN: החלפת PIN מבטלת כל פתיחה קיימת, ואין סוד נוסף לנהל.
 * ניסיונות שגויים: 5 ברצף נועלים את האזור לרבע שעה (נשמר ב-settings — עובד גם ב-serverless).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { sql } from '@/lib/db'

export type PinArea = 'nissim' | 'partners' | 'private' | 'bank'
export const PIN_TTL_MS = 10 * 60 * 1000
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000

const cookieName = (area: PinArea) => `harel_pin_${area}`
const hashPin = (salt: string, pin: string) => createHash('sha256').update(`${salt}:${pin}`).digest('hex')

async function stored(area: PinArea): Promise<{ salt: string; hash: string } | null> {
  const [r] = await sql<{ value: { salt?: string; hash?: string } | null }[]>`select value from settings where key = ${`pin_hash_${area}`}`
  return r?.value?.salt && r.value.hash ? { salt: r.value.salt, hash: r.value.hash } : null
}

const sign = (secret: string, area: PinArea, until: number) => createHmac('sha256', secret).update(`pin:${area}:${until}`).digest('hex').slice(0, 40)

/** עד מתי האזור פתוח (ms), או 0. נקרא בעמוד לפני שאילתת הנתונים. */
export async function pinUnlockedUntil(area: PinArea, now = Date.now()): Promise<number> {
  const raw = (await cookies()).get(cookieName(area))?.value ?? ''
  const [untilS, sig] = raw.split('.')
  const until = Number(untilS)
  if (!until || until <= now || !sig) return 0
  const s = await stored(area)
  if (!s) return 0
  const a = Buffer.from(sign(s.hash, area, until)), b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b) ? until : 0
}

export async function pinConfigured(area: PinArea): Promise<boolean> {
  return Boolean(await stored(area))
}

export type PinResult = { ok: true; until: number } | { ok: false; error: string }

/** בדיקת הקוד. הצלחה → עוגייה חתומה ל-10 דקות. */
export async function checkPin(area: PinArea, pin: string, now = Date.now()): Promise<PinResult> {
  const failKey = `pin_fail_${area}`
  const [f] = await sql<{ value: { count?: number; lockedUntil?: number } | null }[]>`select value from settings where key = ${failKey}`
  const fails = f?.value ?? {}
  if ((fails.lockedUntil ?? 0) > now) return { ok: false, error: `יותר מדי ניסיונות — נסו שוב בעוד ${Math.ceil(((fails.lockedUntil ?? 0) - now) / 60000)} דק׳` }
  const s = await stored(area)
  const good = Boolean(s) && /^\d{4,6}$/.test(pin) && (() => {
    const a = Buffer.from(hashPin(s!.salt, pin), 'hex'), b = Buffer.from(s!.hash, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  })()
  if (!good) {
    const count = (fails.count ?? 0) + 1
    const value = count >= MAX_FAILS ? { count: 0, lockedUntil: now + LOCK_MS } : { count }
    await sql`insert into settings (key, value, description) values (${failKey}, ${sql.json(value)}, 'ניסיונות PIN שגויים')
              on conflict (key) do update set value = excluded.value, updated_at = now()`
    return { ok: false, error: count >= MAX_FAILS ? 'יותר מדי ניסיונות — האזור נעול לרבע שעה' : 'קוד שגוי' }
  }
  if (fails.count) await sql`update settings set value = ${sql.json({ count: 0 })}, updated_at = now() where key = ${failKey}`
  const until = now + PIN_TTL_MS
  ;(await cookies()).set(cookieName(area), `${until}.${sign(s!.hash, area, until)}`, {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: PIN_TTL_MS / 1000,
  })
  return { ok: true, until }
}
