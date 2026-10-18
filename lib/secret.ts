import { timingSafeEqual } from 'node:crypto'

/**
 * סודות משותפים (JOBS_SECRET / CRON_SECRET) — השוואה בלי רווחים ושורות בקצוות.
 * מדביקים אותם ידנית גם ב-Vercel וגם ב-GitHub Secrets, ורווח או ירידת שורה בסוף ההדבקה לא נראים באף אחד מהם.
 * כך נדחו כל הג'ובים ב-401 אחרי העלייה לאוויר (18/10), למרות שהערכים "זהים".
 */
export function envSecret(name: string, env: Record<string, string | undefined> = process.env): string | null {
  const v = (env[name] ?? '').trim()
  return v || null
}

export function secretEq(given: string | null | undefined, secret: string | null | undefined): boolean {
  const a = (given ?? '').trim(), b = (secret ?? '').trim()
  if (!a || !b) return false
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
