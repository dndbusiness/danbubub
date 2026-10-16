/**
 * שער הכניסה (middleware.ts) — העוגייה והטוקן במקום אחד, כדי שגם רינדור ה-PDF הפנימי
 * (lib/pdf.ts) יעבור את השער. בלי ייבוא של node: — רץ גם ב-edge.
 *
 * הטוקן = HMAC-SHA256 של הסיסמה עם מלח קבוע; לא הסיסמה ולא hash חלש שלה.
 */
export const GATE_COOKIE = 'harel_gate'

export async function gateToken(password: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('harel-gate-v2')))
  return Array.from(sig.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** השוואה בזמן קבוע (בלי לחשוף כמה תווים נכונים). */
export function sameToken(a: string | undefined | null, b: string): boolean {
  const x = String(a ?? '')
  if (x.length !== b.length) return false
  let d = 0
  for (let i = 0; i < b.length; i++) d |= x.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** יעד חזרה אחרי הכניסה — רק נתיב פנימי. "//evil.com" או "/\evil.com" הם כתובת חיצונית. */
export function safeNext(next: string | null | undefined): string {
  const n = String(next ?? '')
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/'
}
