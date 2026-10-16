'use server'

import { checkPin, type PinArea, type PinResult } from '@/lib/pin'

/**
 * PIN לאזורים מוגנים — SPEC §6: "סיסמה שנייה (PIN) לאזורים 🔒 — נשאלת בכל
 * כניסה לאזור, פג תוקף אחרי 10 דקות."
 * הקוד נשמר כ-sha256(salt:pin) ב-settings תחת pin_hash_<area>. הגדרה:
 * node scripts/set-pin.mjs <area> <pin>. אין קוד ברירת מחדל.
 * הבדיקה, העוגייה החתומה והנעילה אחרי ניסיונות שגויים — lib/pin.ts.
 */
export type { PinArea }

export async function verifyPin(area: PinArea, pin: string): Promise<PinResult> {
  return checkPin(area, pin)
}
