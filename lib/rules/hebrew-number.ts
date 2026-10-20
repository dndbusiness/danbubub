/**
 * סכום במילים בעברית — לשטר החוב ("סך של 50,000 ₪, במילים: חמישים אלף שקלים חדשים").
 * שקל זכר → מספר בזכר. שלמים בלבד (אגורות מעוגלות). עד 999,999,999.
 * זהה ל-heNumWords בדף (crm/harel-crm.html) — הבדיקה ב-tests/hebrew-number.test.ts משווה ביניהן.
 */
const U = ['', 'אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה']
const TEENS = ['עשרה', 'אחד עשר', 'שנים עשר', 'שלושה עשר', 'ארבעה עשר', 'חמישה עשר', 'שישה עשר', 'שבעה עשר', 'שמונה עשר', 'תשעה עשר']
const TENS = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שישים', 'שבעים', 'שמונים', 'תשעים']
const HUND = ['', 'מאה', 'מאתיים', 'שלוש מאות', 'ארבע מאות', 'חמש מאות', 'שש מאות', 'שבע מאות', 'שמונה מאות', 'תשע מאות']
const THOUS = ['', 'אלף', 'אלפיים', 'שלושת אלפים', 'ארבעת אלפים', 'חמשת אלפים', 'ששת אלפים', 'שבעת אלפים', 'שמונת אלפים', 'תשעת אלפים', 'עשרת אלפים']

/** 1-999 → מילים, עם ו' לפני המילה האחרונה */
function group(n: number): string[] {
  const out: string[] = []
  const h = Math.floor(n / 100), r = n % 100
  if (h) out.push(HUND[h]!)
  if (r >= 10 && r < 20) out.push(TEENS[r - 10]!)
  else { if (r >= 20) out.push(TENS[Math.floor(r / 10)]!); if (r % 10) out.push(U[r % 10]!) }
  if (out.length > 1) out[out.length - 1] = 'ו' + out[out.length - 1]
  return out
}

export function heNumWords(value: number | string): string {
  const n = Math.round(Number(String(value ?? '').replace(/[^\d.]/g, '')) || 0)
  if (n <= 0) return 'אפס'
  if (n > 999_999_999) return ''
  const mil = Math.floor(n / 1e6), th = Math.floor((n % 1e6) / 1000), rest = n % 1000
  // כל חלק: מילות המספר + מילת הסדר (מיליון / אלף)
  const parts: { w: string[]; scale?: string }[] = []
  if (mil) parts.push(mil === 1 ? { w: ['מיליון'] } : mil === 2 ? { w: ['שני'], scale: 'מיליון' } : { w: group(mil), scale: 'מיליון' })
  if (th) parts.push(th <= 10 ? { w: [THOUS[th]!] } : { w: group(th), scale: 'אלף' })
  if (rest) parts.push({ w: group(rest) })
  // ו' לפני החלק האחרון כשהמספר בו מילה אחת ("אלף וחמש מאות", "מיליון ומאתיים אלף", "שלושת אלפים וחמישה")
  const last = parts[parts.length - 1]!
  if (parts.length > 1 && last.w.length === 1 && !last.w[0]!.startsWith('ו')) last.w[0] = 'ו' + last.w[0]
  return parts.flatMap((p) => (p.scale ? [...p.w, p.scale] : p.w)).join(' ')
}
