/**
 * טפסים מ-PDF (מפרט "מערכת טפסים" של WISE) — הכללים הטהורים.
 *
 * מסמך PDF (טופס בנק, הסכמה לנתוני אשראי, כתב הרשאה) עולה למערכת, ועליו מציבים שדות:
 * חתימה, ראשי תיבות, שם, ת"ז, תאריך, טקסט חופשי, תיבת סימון. כל שדה שייך לחותם אחד
 * (לווה 1, לווה 2…). המיקום נשמר יחסית לעמוד (0..1, ראשית בפינה השמאלית-עליונה כמו
 * במסך), כדי שאותה תבנית תעבוד בכל רזולוציה. ההמרה לקואורדינטות של PDF (ראשית למטה) — כאן.
 */

export const FIELD_KINDS = {
  signature: 'חתימה',
  initials: 'ראשי תיבות',
  name: 'שם מלא',
  id_number: 'ת"ז',
  date: 'תאריך',
  text: 'טקסט',
  checkbox: 'תיבת סימון',
} as const
export type FieldKind = keyof typeof FIELD_KINDS

export interface PdfField {
  id: string
  /** 0 = העמוד הראשון */
  page: number
  /** יחסי לרוחב/גובה העמוד, ראשית בפינה השמאלית-העליונה */
  x: number; y: number; w: number; h: number
  kind: FieldKind
  /** מספר החותם (1 = לווה 1) */
  signer: number
  label?: string
  /** טקסט / תיבת סימון: חובה למלא? (חתימה, שם, ת"ז ותאריך — תמיד) */
  required?: boolean
  /** טקסט: מילוי אוטומטי מכרטיס הלקוח (PREFILL_KEYS) — החותם רואה את הערך ויכול לתקן; "notes" — ההערות של השולח, לקריאה בלבד */
  src?: PrefillKey
}

/**
 * מאיפה שדה טקסט בטופס מתמלא מראש (דן, 17/10: "השם, ת"ז, המייל, כל הפרטים שכבר ישנם — יוצמדו לטופס").
 * signer_* — של החותם שהשדה שייך לו (לווה 1 = הלקוח, לווה 2 = בן/בת הזוג…). השאר — מהתיק.
 * הערכים מחושבים בדף (מהכרטיס) ונשלחים עם המסמך; השרת רק מנקה ושומר.
 */
export const PREFILL_KEYS = {
  signer_email: 'מייל החותם', signer_phone: 'טלפון החותם', signer_address: 'כתובת החותם',
  // טפסי הגופים מבקשים שם פרטי ושם משפחה בנפרד — מהשם המלא (המילה הראשונה / השאר); החותם מתקן אם צריך
  signer_first_name: 'שם פרטי של החותם', signer_last_name: 'שם משפחה של החותם',
  client_name: 'שם הלקוח (לווה 1)', client_id: 'ת״ז הלקוח (לווה 1)', spouse_name: 'שם בן/בת הזוג', spouse_id: 'ת״ז בן/בת הזוג',
  company: 'שם החברה', amount: 'סכום הבקשה', fee: 'שכר טרחה', service: 'השירות',
  car_model: 'יצרן ודגם הרכב', car_plate: 'מספר רישוי', car_year: 'שנת ייצור',
  notes: 'הערות השולח (לקריאה בלבד)',
  // פרטי היועץ (הגדרות ← "פרטי היועץ בטפסים"): בטפסי הגופים יש טבלה "מסמיכים את" — ממולא מהמשרד, לקריאה בלבד אצל החותם
  advisor_name: 'שם היועץ / החברה', advisor_id: 'ח.פ / ת״ז היועץ', advisor_license: 'מספר רישיון היועץ',
  advisor_company: 'שם חברת הייעוץ', advisor_company_id: 'ח.פ חברת הייעוץ',
  advisor_phone: 'טלפון היועץ', advisor_email: 'מייל היועץ', advisor_address: 'כתובת היועץ',
} as const
export type PrefillKey = keyof typeof PREFILL_KEYS
/** שדות שהשולח ממלא והחותם רק רואה (ההערות, פרטי היועץ) — החותם לא יכול לשנות אותם. */
export const senderFilled = (src: string | undefined) => src === 'notes' || String(src ?? '').startsWith('advisor_')

export interface PageSize { w: number; h: number }

export const MAX_UPLOAD_FILES = 5
/** מגבלת גוף בקשה של Vercel היא 4.5MB — משאירים מרווח */
export const MAX_UPLOAD_BYTES = 4_000_000
export const MAX_FIELDS = 300
export const MAX_PDF_PAGES = 60

/** הקבצים שהועלו: PDF בלבד, עד 5, עד 4MB ביחד. */
export function validateUploads(files: { name: string; size: number; head: string }[]): string[] {
  const errs: string[] = []
  if (!files.length) errs.push('לא נבחר קובץ')
  if (files.length > MAX_UPLOAD_FILES) errs.push(`עד ${MAX_UPLOAD_FILES} קבצים בבת אחת`)
  for (const f of files) if (!f.head.startsWith('%PDF-')) errs.push(`"${f.name}" אינו PDF`)
  const total = files.reduce((a, f) => a + f.size, 0)
  if (total > MAX_UPLOAD_BYTES) errs.push(`הקבצים גדולים מדי (${(total / 1e6).toFixed(1)}MB) — עד ${MAX_UPLOAD_BYTES / 1e6}MB ביחד`)
  return errs
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

/** ניקוי שדה שהגיע מהדפדפן: רק המפתחות המוכרים, מספרים בטווח. */
export function cleanField(raw: unknown): PdfField | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = String(r.kind) as FieldKind
  if (!(kind in FIELD_KINDS)) return null
  const f: PdfField = {
    id: String(r.id ?? '').slice(0, 40), page: Math.trunc(num(r.page)), x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h), kind,
    signer: Math.trunc(num(r.signer)),
  }
  if (!f.id || ![f.page, f.x, f.y, f.w, f.h, f.signer].every(Number.isFinite)) return null
  if (r.label != null && String(r.label).trim()) f.label = String(r.label).trim().slice(0, 60)
  if ((kind === 'text' || kind === 'checkbox') && r.required === true) f.required = true
  if (kind === 'text' && typeof r.src === 'string' && r.src in PREFILL_KEYS) f.src = r.src as PrefillKey
  return f
}

/** תקינות השדות מול המסמך ומספר החותמים. */
export function validatePdfFields(fields: PdfField[], pages: number, signers: number): string[] {
  const errs: string[] = []
  if (!fields.length) return ['לא הוצבו שדות על המסמך']
  if (fields.length > MAX_FIELDS) errs.push(`יותר מדי שדות (עד ${MAX_FIELDS})`)
  const ids = new Set<string>()
  for (const f of fields) {
    if (ids.has(f.id)) errs.push('מזהה שדה כפול'); ids.add(f.id)
    if (f.page < 0 || f.page >= pages) errs.push(`שדה בעמוד ${f.page + 1} — במסמך ${pages} עמודים`)
    if (f.signer < 1 || f.signer > signers) errs.push(`שדה של לווה ${f.signer} — במסמך ${signers} חותמים`)
    if (f.w <= 0 || f.h <= 0 || f.x < 0 || f.y < 0 || f.x + f.w > 1.0001 || f.y + f.h > 1.0001) errs.push(`שדה "${f.label ?? FIELD_KINDS[f.kind]}" יוצא מגבולות העמוד`)
  }
  for (let s = 1; s <= signers; s++) if (!fields.some((f) => f.signer === s && f.kind === 'signature')) errs.push(`ללווה ${s} אין שדה חתימה`)
  return [...new Set(errs)]
}

/**
 * טופס עם מקום לשני לווים ולקוח עם לווה אחד (דן, 21/10 — כתבי ההסמכה של הגופים בנויים ל-2): נשלח רק ל-n הלווים
 * הראשונים, והשדות של האחרים נשארים ריקים בטופס החתום. רק מהסוף — לווה 2 לא נעלם כשלווה 3 נשאר.
 */
export const fieldsForSigners = (fields: PdfField[], n: number) => fields.filter((f) => f.signer <= Math.max(1, n))

/** כמה חותמים התבנית צריכה = מספר החותם הגבוה ביותר שיש לו שדה. */
export const signersNeeded = (fields: PdfField[]) => fields.reduce((m, f) => Math.max(m, f.signer), 0)

export const fieldsOf = (fields: PdfField[], signer: number) => fields.filter((f) => f.signer === signer)

/** מלבן ב-PDF (נקודות, ראשית בפינה השמאלית-התחתונה). */
export function pdfRect(f: PdfField, page: PageSize): { x: number; y: number; w: number; h: number } {
  return { x: f.x * page.w, y: page.h - (f.y + f.h) * page.h, w: f.w * page.w, h: f.h * page.h }
}

/** מה החותם צריך למלא בעצמו (מעבר לשם, ת"ז וחתימה): שדות טקסט ותיבות סימון. */
export function signerInputs(fields: PdfField[], signer: number): PdfField[] {
  return fieldsOf(fields, signer).filter((f) => f.kind === 'text' || f.kind === 'checkbox')
}

/** בדיקת הערכים שהחותם מילא. מחזיר את הערכים הנקיים (רק השדות שלו). */
export function checkSignerValues(fields: PdfField[], signer: number, raw: unknown, notes = '', fixed: Record<string, string> = {}): { values: Record<string, string>; errors: string[] } {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const values: Record<string, string> = {}, errors: string[] = []
  for (const f of signerInputs(fields, signer)) {
    // ההערות של השולח — לא בידי החותם: נכתב מה שנשלח, גם אם הדפדפן שלח משהו אחר
    if (f.src === 'notes') { if (notes) values[f.id] = notes.slice(0, 200); continue }
    // פרטי היועץ — מה שהשולח מילא (מההגדרות), לא מה שהדפדפן שלח
    if (senderFilled(f.src)) { const v = String(fixed[f.id] ?? '').trim().slice(0, 200); if (v) values[f.id] = v; continue }
    const v = f.kind === 'checkbox' ? (src[f.id] === true || src[f.id] === 'on' || src[f.id] === '1' ? '1' : '') : String(src[f.id] ?? '').trim().slice(0, 200)
    if (v) values[f.id] = v
    else if (f.required) errors.push(f.kind === 'checkbox' ? `נא לסמן: ${f.label ?? 'תיבת הסימון'}` : `נא למלא: ${f.label ?? 'שדה טקסט'}`)
  }
  return { values, errors }
}

/** תאריך לחתימה: dd/mm/yyyy לפי שעון ישראל. */
export function ilDate(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('day')}/${g('month')}/${g('year')}`
}

/** ראשי תיבות משם מלא: "דנה כהן" → "ד.כ." */
export function initialsOf(name: string): string {
  return String(name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0] + '.').join('')
}

/** הטקסט שנכתב בשדה (חתימה/ראשי תיבות מצוירים — לא כאן). */
export function fieldText(f: PdfField, s: { name: string; idNumber: string; signedAt: Date; values: Record<string, string> }): string {
  switch (f.kind) {
    case 'name': return s.name
    case 'id_number': return s.idNumber
    case 'date': return ilDate(s.signedAt)
    case 'text': return s.values[f.id] ?? ''
    case 'checkbox': return s.values[f.id] ? 'X' : ''
    default: return ''
  }
}

const RTL = /[֐-׿יִ-ﭏ]/
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<', '{': '}', '}': '{' }

/**
 * עברית לציור ב-PDF (pdf-lib מצייר משמאל לימין, בלי bidi): סדר "ויזואלי".
 * שורה שיש בה עברית = כיוון בסיס ימין-לשמאל: רצפים של אותיות/ספרות לטיניות נשארים כמו שהם,
 * השאר מתהפך, וסוגריים מתחלפים. בלי עברית — מחזיר כמו שהוא.
 */
export function visualOrder(s: string): string {
  const str = String(s ?? '')
  if (!RTL.test(str)) return str
  // רצף LTR = אותיות לטיניות/ספרות, כולל סימני חיבור פנימיים (03-555, a.b@c.com, 12/10/2026)
  const runs = str.match(/[A-Za-z0-9](?:[A-Za-z0-9@._\-/:+]*[A-Za-z0-9])?|[^A-Za-z0-9]/g) ?? []
  return runs.reverse().map((r) => (r.length === 1 && !/[A-Za-z0-9]/.test(r) ? MIRROR[r] ?? r : r)).join('')
}

/**
 * המחרוזות ל-pdf-lib כדי שעברית תצא בסדר הנכון (דן 31/10 — נמצא בבדיקת עורך ה-PDF: שם ש"נחתם" יצא "ןהכ השמ").
 * pdf-lib מעביר כל drawText דרך fontkit, ו-fontkit הופך מחרוזת שהכתב החזק הראשון בה עברי. לכן כותבים ברצפים, משמאל לימין:
 * רצף לטיני/ספרות — כמו שהוא; רצף שיש בו עברית — הפוך (fontkit מחזיר אותו לסדר החזותי); רצף של רווחים/פיסוק בלבד — כמו שהוא.
 */
export function fontkitRuns(s: string): string[] {
  const v = visualOrder(s)
  return (v.match(/[A-Za-z0-9](?:[A-Za-z0-9@._\-/:+]*[A-Za-z0-9])?|[^A-Za-z0-9]+/g) ?? []).map((r) => (RTL.test(r) ? [...r].reverse().join('') : r))
}

/** "התבניות הכי פעילות": ספירה לפי template_key ב-N הימים האחרונים. */
export function mostActive(rows: { template_key: string | null; created_at: string | Date }[], since: Date, top = 5): { key: string; n: number }[] {
  const by = new Map<string, number>()
  for (const r of rows) if (r.template_key && new Date(r.created_at) >= since) by.set(r.template_key, (by.get(r.template_key) ?? 0) + 1)
  return [...by].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)).slice(0, top)
}

/**
 * כמה תבניות כמסמך אחד ("חבילה", דן 18/10): השדות של כל תבנית עוברים לעמודים שלה במסמך המאוחד,
 * והמזהים מקבלים קידומת t<i>_ (ייחודיים גם כשבשתי תבניות יש שדה "s1"). הדף בונה את אותם מזהים למילוי מהתיק.
 */
export function bundleFields(ts: { fields: PdfField[]; pages: number }[]): PdfField[] {
  const out: PdfField[] = []
  let offset = 0
  ts.forEach((t, i) => { for (const f of t.fields) out.push({ ...f, id: (`t${i}_` + f.id).slice(0, 40), page: f.page + offset }); offset += t.pages })
  return out
}
