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

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)(\?)?\s*\}\}/g
const BLANK = '__________'

/**
 * נוסח עם {{שדות}} → HTML בטוח. הנוסח עצמו טקסט (לא HTML): כל תו מוברח.
 *   שורה שמתחילה ב-"# " → כותרת · "- " → סעיף ברשימה · שורה ריקה → פסקה חדשה.
 * שדה בלי ערך מוצג כקו ריק ומדווח ב-missing — כדי שלא יישלח הסכם עם חור בלי לדעת.
 * {{שדה?}} = שדה רשות (למשל בן/בת זוג): בלי ערך מוצג "—" ולא נחשב חסר.
 */
export const SIGN_HERE = '@@חתימות@@'
export const PAGE_BREAK = '@@עמוד חדש@@'
/** מה שהשורות המיוחדות הופכות ל-HTML — דף החתימה וה-PDF מחליפים את SIGN_HERE_HTML בחתימות + חותמת החברה */
export const SIGN_HERE_HTML = '<div class="signhere"></div>'
export const PAGE_BREAK_HTML = '<div class="pagebreak"></div>'

export function renderAgreement(template: string, fields: Record<string, FieldValue>): { html: string; missing: string[] } {
  const missing = new Set<string>()
  const empty = (k: string) => { const v = fields[k]; return v === null || v === undefined || String(v).trim() === '' }
  const fill = (line: string) => escapeHtml(line).replace(PLACEHOLDER, (_m, key: string, opt?: string) => {
    const v = fields[key]
    if (v === null || v === undefined || String(v).trim() === '') { if (opt) return '—'; missing.add(key); return BLANK }
    return '<b>' + escapeHtml(String(v)) + '</b>'
  })
  const out: string[] = []
  let para: string[] = [], list: string[] = []
  const flushPara = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = [] } }
  const flushList = () => { if (list.length) { out.push('<ol>' + list.map((x) => '<li>' + x + '</li>').join('') + '</ol>'); list = [] } }
  for (const raw of String(template ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) { flushPara(); flushList(); continue }
    /* @@חתימות@@ — מקום חתימה (הלקוח + חותמת החברה) · @@עמוד חדש@@ — מסמך מצורף (שטר חוב) מתחיל בעמוד חדש */
    if (line === SIGN_HERE) { flushPara(); flushList(); out.push(SIGN_HERE_HTML); continue }
    if (line === PAGE_BREAK) { flushPara(); flushList(); out.push(PAGE_BREAK_HTML); continue }
    /* שורה שכל השדות בה רשות וכולם ריקים (בן/בת זוג, ערב) — לא מוצגת בכלל, במקום "—, ת״ז —" */
    const ph = [...line.matchAll(PLACEHOLDER)]
    if (ph.length && ph.every((m) => m[2] && empty(m[1] ?? ''))) continue
    if (line.startsWith('# ')) { flushPara(); flushList(); out.push('<h2>' + fill(line.slice(2)) + '</h2>'); continue }
    if (line.startsWith('- ')) { flushPara(); list.push(fill(line.slice(2))); continue }
    flushList(); para.push(fill(line))
  }
  flushPara(); flushList()
  return { html: out.join('\n'), missing: [...missing] }
}

/** השדות שהנוסח מבקש, לפי סדר הופעה (כולל שדות רשות). */
export function templateFields(template: string): string[] {
  const seen: string[] = []
  for (const m of String(template ?? '').matchAll(PLACEHOLDER)) { const k = m[1] ?? ''; if (k && !seen.includes(k)) seen.push(k) }
  return seen
}

/** השדות שחובה למלא — שדה שמופיע בנוסח רק כ-{{שדה?}} לא נכלל. */
export function requiredFields(template: string): string[] {
  const req: string[] = []
  for (const m of String(template ?? '').matchAll(PLACEHOLDER)) { const k = m[1] ?? ''; if (k && !m[2] && !req.includes(k)) req.push(k) }
  return req
}

/** טיוטה = הסימון "[טיוטה" בנוסח (כמו בדף). נוסח כזה לא נשלח — גם אם הדף לא חסם. */
export const isSignDraft = (t: string | null | undefined): boolean => /\[\s*טיוטה/.test(String(t ?? ''))

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

/* ── מערכת חתימות: כמה חותמים, קוד אימות, ספריית תבניות (018) ───────────────── */

export const SIGN_CATEGORIES = {
  agreement: 'הסכם התקשרות', bank: 'טפסי בנק', fund: 'טפסי קרן', insurance: 'ביטוח', poa: 'ייפוי כוח', general: 'כללי',
} as const
export type SignCategory = keyof typeof SIGN_CATEGORIES

export interface SignerInput { label: string; name?: string | null; email?: string | null; phone?: string | null; requireOtp?: boolean; fields?: Record<string, FieldValue>; prefill?: unknown }

export const MAX_SIGNERS = 6

/** בדיקת רשימת החותמים לפני שליחה. מחזיר שגיאות בעברית (ריקה = תקין). */
export function validateSigners(signers: SignerInput[], opts: { otpWhatsApp?: boolean } = {}): string[] {
  const errors: string[] = []
  if (!signers.length) errors.push('אין חותמים')
  if (signers.length > MAX_SIGNERS) errors.push(`עד ${MAX_SIGNERS} חותמים במסמך`)
  const seen = new Set<string>()
  signers.forEach((s, i) => {
    const who = s.label?.trim() || `חותם ${i + 1}`
    const email = String(s.email ?? '').trim().toLowerCase(), phone = String(s.phone ?? '').replace(/\D/g, '')
    if (!email && !phone) errors.push(`${who}: חסר מייל או טלפון`)
    if (email && !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(email)) errors.push(`${who}: מייל לא תקין`)
    if (s.requireOtp && !email && !(opts.otpWhatsApp && phone)) errors.push(`${who}: קוד אימות נשלח במייל — חסר מייל`)
    if (email) { if (seen.has(email)) errors.push(`${who}: אותו מייל לשני חותמים`); seen.add(email) }
  })
  return errors
}

/** "dana@gmail.com" → "da***@gmail.com" — להצגה בדף החתימה בלי לחשוף את הכתובת המלאה. */
export function maskEmail(email: string | null | undefined): string {
  const [u = '', d = ''] = String(email ?? '').split('@')
  if (!d) return ''
  return `${u.slice(0, Math.min(2, u.length))}***@${d}`
}

/** "0521234567" → "052***4567" */
export function maskPhone(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/\D/g, '')
  return d.length < 7 ? '' : `${d.slice(0, 3)}***${d.slice(-4)}`
}

/** לאן נשלח קוד האימות: מייל אם יש; אחרת וואטסאפ (Green-API, דרך outbox) כשמוגדר ויש טלפון. */
export function otpChannel(r: { send_email?: string | null; send_phone?: string | null }, whatsappReady: boolean): 'email' | 'whatsapp' | null {
  if (String(r.send_email ?? '').trim()) return 'email'
  if (whatsappReady && String(r.send_phone ?? '').replace(/\D/g, '').length >= 9) return 'whatsapp'
  return null
}

/** טלפון ישראלי → יעד וואטסאפ בינלאומי: "052-1234567" → "972521234567" */
export function waTarget(phone: string | null | undefined): string | null {
  const d = String(phone ?? '').replace(/\D/g, '')
  if (d.length < 9) return null
  return d.startsWith('972') ? d : d.startsWith('0') ? '972' + d.slice(1) : d
}

export const OTP_TTL_MS = 10 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RESEND_MS = 60 * 1000

export type OtpState = 'not_required' | 'verified' | 'need_send' | 'sent' | 'locked'

/** איפה החותם עומד בקוד האימות. */
export function otpState(r: { require_otp: boolean; otp_verified_at: string | Date | null; otp_hash: string | null; otp_expires_at: string | Date | null; otp_attempts: number }, now: Date): OtpState {
  if (!r.require_otp) return 'not_required'
  if (r.otp_verified_at) return 'verified'
  if (!r.otp_hash || !r.otp_expires_at || new Date(r.otp_expires_at).getTime() <= now.getTime()) return 'need_send'
  return r.otp_attempts >= OTP_MAX_ATTEMPTS ? 'locked' : 'sent'
}

/** אפשר לשלוח קוד חדש? (פעם בדקה — שלא יציפו את המייל של החותם) */
export function canResendOtp(sentAt: string | Date | null | undefined, now: Date): boolean {
  return !sentAt || now.getTime() - new Date(sentAt).getTime() >= OTP_RESEND_MS
}

/** ה-PDF המשותף: נוסח אחד לכל טביעה (חותמים עם אותו נוסח — חתימות זה לצד זה). */
export function groupByDocument<T extends { doc_hash: string; signer_order: number }>(rows: T[]): { doc_hash: string; rows: T[] }[] {
  const out: { doc_hash: string; rows: T[] }[] = []
  for (const r of [...rows].sort((a, b) => a.signer_order - b.signer_order)) {
    const g = out.find((x) => x.doc_hash === r.doc_hash)
    if (g) g.rows.push(r); else out.push({ doc_hash: r.doc_hash, rows: [r] })
  }
  return out
}

/* ── מילוי מהתיק, הערות ותיעוד (דן, 17/10) ───────────────────────────────────── */

/**
 * מה שמולא מראש מכרטיס הלקוח לחותם: שם, ת"ז, ושדות טקסט בטופס (לפי מזהה שדה).
 * הצעה בלבד — החותם רואה, מתקן אם צריך, ומה שהוא שולח הוא מה שנחתם. ההשוואה נשמרת לתיעוד.
 */
export interface Prefill { name?: string; idNumber?: string; values?: Record<string, string> }

const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n)

/** ניקוי מה שהדף שלח: רק מחרוזות קצרות, ת"ז רק ספרות, ושדות רק מהרשימה שמותר (allowed). */
export function cleanPrefill(raw: unknown, allowed?: string[] | null): Prefill {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Prefill = {}
  const name = clip(r.name, 120); if (name) out.name = name
  const id = String(r.idNumber ?? '').replace(/\D/g, '').slice(0, 9); if (id) out.idNumber = id
  const v = r.values && typeof r.values === 'object' ? (r.values as Record<string, unknown>) : {}
  const values: Record<string, string> = {}
  for (const [k, x] of Object.entries(v)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(k) || (allowed && !allowed.includes(k))) continue
    const s = clip(x, 200); if (s) values[k] = s
  }
  if (Object.keys(values).length) out.values = values
  return out
}

/** הערות השולח לטופס: טקסט חופשי עד 2000 תווים, שורות נשמרות. בלי {{ — שלא ייקרא כשדה בנוסח. */
export function cleanNotes(raw: unknown): string {
  return String(raw ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }')
    .split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000)
}

/** נוסח מוקלד + הערות בסוף, כחלק מהמסמך (נכנס לטביעה ולמה שנחתם). "- " בתחילת שורה — שלא תהפוך לרשימה בטעות. */
/**
 * הערות החברה בסוף הטופס (דן, 20/10: "מקום להערות שלנו בכל סוף טופס, ונמלא רק הערות במועד ההחתמה").
 * בהסכם (always) — תמיד יש סעיף הערות, גם ריק ("אין הערות"). מסמך מצורף (שטר חוב, אחרי @@עמוד חדש@@) — ההערות לפניו, בסוף ההסכם.
 */
export function withNotes(template: string, notes: string, always = false): string {
  if (!notes && !always) return template
  const body = notes ? notes.split('\n').map((l) => (l.startsWith('# ') || l.startsWith('- ') || l.startsWith('@@') ? '‏' + l : l)).join('\n') : 'אין הערות.'
  const t = String(template ?? ''), i = t.indexOf('\n' + PAGE_BREAK)
  const sec = '\n\n# הערות\n' + body
  return i >= 0 ? t.slice(0, i).replace(/\s+$/, '') + sec + '\n' + t.slice(i) : t.replace(/\s+$/, '') + sec
}

/** טופס PDF: הטביעה של מה שהחותם רואה = הקובץ + השדות שלו + ההערות (אם יש). */
export function pdfSignerHash(sha: (s: string) => string, fileHash: string, mine: unknown[], notes: string): string {
  return sha(fileHash + ':' + JSON.stringify(mine) + (notes ? ':notes:' + sha(notes) : ''))
}

/** התאמה בין מה שבכרטיס למה שהחותם הזין: ת"ז (מדויק) ושם (בלי רווחים כפולים / גרשיים). null = לא היה מה להשוות. */
export function identityCheck(prefill: Prefill | null | undefined, name: string, idNumber: string): { id: boolean | null; name: boolean | null } {
  const norm = (s: string) => String(s ?? '').replace(/["'׳״`.\-]/g, '').replace(/\s+/g, ' ').trim()
  const pid = prefill?.idNumber ? normalizeIsraeliId(prefill.idNumber) : null
  const sid = normalizeIsraeliId(idNumber)
  return {
    id: pid ? pid === sid : null,
    name: prefill?.name ? norm(prefill.name) === norm(name) : null,
  }
}

/** אירוע בתיעוד החתימה (נשמר בשורת החותם עד החתימה, ואז ננעל איתה). */
export type SignEventKind = 'sent' | 'email_queued' | 'link_renewed' | 'shared' | 'opened' | 'otp_sent' | 'otp_verified' | 'otp_failed' | 'signed'
export interface SignEvent { at: string; kind: SignEventKind; ip?: string | null; ua?: string | null; detail?: string | null }

export const SIGN_EVENT_LABELS: Record<SignEventKind, string> = {
  sent: 'נשלח לחתימה', email_queued: 'הזמנה במייל', link_renewed: 'קישור חדש (הקודם בוטל)', shared: 'הקישור נמסר', opened: 'המסמך נפתח',
  otp_sent: 'נשלח קוד אימות', otp_verified: 'הקוד אומת', otp_failed: 'קוד שגוי', signed: 'נחתם',
}
export const MAX_SIGN_EVENTS = 60

export function signEvent(kind: SignEventKind, at: Date, meta: { ip?: string | null; ua?: string | null; detail?: string | null } = {}): SignEvent {
  const e: SignEvent = { at: at.toISOString(), kind }
  if (meta.ip) e.ip = clip(meta.ip, 64)
  if (meta.ua) e.ua = clip(meta.ua, 300)
  if (meta.detail) e.detail = clip(meta.detail, 200)
  return e
}

/** "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 …) … Safari" → "iPhone · Safari" — לעמוד התיעוד (המחרוזת המלאה נשמרת). */
export function deviceLabel(ua: string | null | undefined): string {
  const u = String(ua ?? '')
  if (!u) return '—'
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'מכשיר אחר'
  const br = /WhatsApp/.test(u) ? 'WhatsApp' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /Edg\//.test(u) ? 'Edge' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /FxiOS|Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'דפדפן'
  return os + ' · ' + br
}
