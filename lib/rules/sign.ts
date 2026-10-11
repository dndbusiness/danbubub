/**
 * חתימה דיגיטלית על הסכם התקשרות — הכללים הטהורים (בלי I/O, בלי new Date() בלי ארגומנט).
 * הצד שמדבר עם ה-DB, הדרייב וה-PDF נמצא ב-lib/sign.
 */

/** ת"ז ישראלית: 9 ספרות (משלימים אפסים משמאל) + ספרת ביקורת. */
export function normalizeIsraeliId(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits || digits.length > 9) return null
  return digits.padStart(9, '0')
}

export function isValidIsraeliId(raw: string): boolean {
  const id = normalizeIsraeliId(raw)
  if (!id || /^0+$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * ((i % 2) + 1)
    if (d > 9) d -= 9
    sum += d
  }
  return sum % 10 === 0
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export type FieldValue = string | number | null | undefined

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g
const BLANK = '__________'

/**
 * נוסח עם {{שדות}} → HTML בטוח. הנוסח עצמו טקסט (לא HTML): כל תו מוברח.
 *   שורה שמתחילה ב-"# " → כותרת · "- " → סעיף ברשימה · שורה ריקה → פסקה חדשה.
 * שדה בלי ערך מוצג כקו ריק ומדווח ב-missing — כדי שלא יישלח הסכם עם חור בלי לדעת.
 */
export function renderAgreement(template: string, fields: Record<string, FieldValue>): { html: string; missing: string[] } {
  const missing = new Set<string>()
  const fill = (line: string) => escapeHtml(line).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = fields[key]
    if (v === null || v === undefined || String(v).trim() === '') { missing.add(key); return BLANK }
    return '<b>' + escapeHtml(String(v)) + '</b>'
  })
  const out: string[] = []
  let para: string[] = [], list: string[] = []
  const flushPara = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = [] } }
  const flushList = () => { if (list.length) { out.push('<ol>' + list.map((x) => '<li>' + x + '</li>').join('') + '</ol>'); list = [] } }
  for (const raw of String(template ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) { flushPara(); flushList(); continue }
    if (line.startsWith('# ')) { flushPara(); flushList(); out.push('<h2>' + fill(line.slice(2)) + '</h2>'); continue }
    if (line.startsWith('- ')) { flushPara(); list.push(fill(line.slice(2))); continue }
    flushList(); para.push(fill(line))
  }
  flushPara(); flushList()
  return { html: out.join('\n'), missing: [...missing] }
}

/** השדות שהנוסח מבקש, לפי סדר הופעה. */
export function templateFields(template: string): string[] {
  const seen: string[] = []
  for (const m of String(template ?? '').matchAll(PLACEHOLDER)) { const k = m[1] ?? ''; if (k && !seen.includes(k)) seen.push(k) }
  return seen
}

export type SignStatus = 'sent' | 'opened' | 'signed' | 'cancelled'
export type SignState = 'open' | 'signed' | 'cancelled' | 'expired'

/** מה הלקוח רואה כשהוא פותח את הקישור. */
export function signState(r: { status: SignStatus; expires_at: string | Date; deleted_at?: string | Date | null }, now: Date): SignState {
  if (r.deleted_at || r.status === 'cancelled') return 'cancelled'
  if (r.status === 'signed') return 'signed'
  return new Date(r.expires_at).getTime() <= now.getTime() ? 'expired' : 'open'
}

export interface Submission { name: string; idNumber: string; signature: string; agree: boolean }

/** בדיקת הטופס של הלקוח. מחזיר רשימת שגיאות בעברית (ריקה = תקין). */
export function validateSubmission(s: Partial<Submission>): string[] {
  const errors: string[] = []
  const name = String(s.name ?? '').trim()
  if (name.length < 2 || !/[\p{L}]/u.test(name)) errors.push('נא למלא שם מלא')
  if (!isValidIsraeliId(String(s.idNumber ?? ''))) errors.push('מספר תעודת הזהות לא תקין')
  const sig = String(s.signature ?? '')
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig)) errors.push('נא לחתום במסגרת')
  else if (sig.length < 1500) errors.push('החתימה קצרה מדי — נא לחתום שוב')
  else if (sig.length >= 600000) errors.push('החתימה גדולה מדי — נא לנקות ולחתום שוב')
  if (s.agree !== true) errors.push('נא לאשר שקראת את ההסכם ושאתה מסכים לו')
  return errors
}

/** תוקף הקישור — ברירת מחדל 14 יום, טווח 1-60. */
export function expiryFrom(now: Date, days: number | null | undefined): Date {
  const d = Math.min(60, Math.max(1, Math.round(Number(days) || 14)))
  return new Date(now.getTime() + d * 86_400_000)
}
