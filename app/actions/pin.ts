'use server'

import { createHash, timingSafeEqual } from 'node:crypto'
import { sql } from '@/lib/db'

/**
 * PIN לאזורים מוגנים — SPEC §6: "סיסמה שנייה (PIN) לאזורים 🔒 — נשאלת בכל
 * כניסה לאזור, פג תוקף אחרי 10 דקות."
 * הקוד נשמר כ-sha256(salt:pin) ב-settings תחת pin_hash_<area>. הגדרה:
 * node scripts/set-pin.mjs <area> <pin>. אין קוד ברירת מחדל.
 */
export type PinArea = 'nissim' | 'partners' | 'private' | 'bank'

function hashPin(salt: string, pin: string): string {
  return createHash('sha256').update(`${salt}:${pin}`).digest('hex')
}

export async function verifyPin(area: PinArea, pin: string): Promise<boolean> {
  if (!/^\d{4,6}$/.test(pin)) return false
  const rows = await sql<{ value: { salt: string; hash: string } }[]>`select value from settings where key = ${`pin_hash_${area}`}`
  const stored = rows[0]?.value
  if (!stored?.salt || !stored?.hash) return false
  const a = Buffer.from(hashPin(stored.salt, pin), 'hex')
  const b = Buffer.from(stored.hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function pinConfigured(area: PinArea): Promise<boolean> {
  const rows = await sql<{ n: number }[]>`select count(*)::int as n from settings where key = ${`pin_hash_${area}`}`
  return (rows[0]?.n ?? 0) > 0
}
