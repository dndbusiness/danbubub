/**
 * אחסון סודות — ADDENDUM הנחיה 15: "refresh token ב-Vault. אסור לשמור סיסמאות."
 *
 * ב-Supabase: Vault (pgsodium) — הסוד מוצפן ע"י המסד עם מפתח שאינו בטבלה.
 * ב-Postgres רגיל (השלב הנוכחי) אין Vault; המקבילה: AES-256-GCM עם מפתח שיושב
 * **רק בסביבת השרת** (SECRETS_KEY). הטבלה integration_secrets מחזיקה ciphertext בלבד,
 * ו-integrations.vault_secret_id מצביע עליו. גיבוי של ה-DB בלי המפתח = חסר ערך לתוקף.
 * המעבר ל-Vault הוא החלפת שתי הפונקציות כאן בלבד.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export function secretsKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  if (!env.SECRETS_KEY) return null
  // מקבלים כל מחרוזת; נגזר ממנה מפתח 32 בתים.
  return createHash('sha256').update(env.SECRETS_KEY).digest()
}

export interface Sealed { iv: string; tag: string; ciphertext: string; alg: 'aes-256-gcm' }

export function seal(plain: string, key: Buffer): Sealed {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ct.toString('base64'), alg: 'aes-256-gcm' }
}

export function open(sealed: Sealed, key: Buffer): string {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
  d.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(sealed.ciphertext, 'base64')), d.final()]).toString('utf8')
}
