import { readFileSync, existsSync } from 'node:fs'

/**
 * שער הגישה הזמני (middleware.ts) חוסם כל מסך כשמוגדר APP_PASSWORD — וכך זה
 * על השרת תמיד. בלי זה כל בדיקת Playwright הייתה מצלמת את מסך הכניסה.
 * פתיחה חד-פעמית דרך ?key=, בדיוק כמו קישור מוואטסאפ; הקוקי נשמר לשאר הריצה.
 */
export function appPassword() {
  if (process.env.APP_PASSWORD) return process.env.APP_PASSWORD
  if (!existsSync('.env.local')) return null
  return readFileSync('.env.local', 'utf8').match(/^APP_PASSWORD=(.*)$/m)?.[1]?.trim() || null
}

export async function unlockGate(page, base) {
  const pw = appPassword()
  if (!pw) return false
  await page.goto(`${base}/?key=${encodeURIComponent(pw)}`, { waitUntil: 'load' })
  if (page.url().includes('/gate')) throw new Error('שער הגישה דחה את APP_PASSWORD — הסיסמה בסביבה לא זהה לזו של השרת')
  return true
}
