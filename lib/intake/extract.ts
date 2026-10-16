/**
 * חילוץ שדות ממסמך — ADDENDUM ב.3 שלב 3.
 * "כללים לספקים חוזרים (תבנית לכל ספק נלמדת מהמסמך הראשון שאושר ידנית) + LLM למסמך
 *  לא מוכר → תמיד עובר אישור אנושי לפני שנחשב verified." (הנחיה 17)
 *
 * טהור: טקסט + ספקים ידועים → הצעה עם ציון ביטחון. ה-LLM ב-lib/intake/llm.ts.
 */

export interface KnownSupplier { id: string; name: string; aliases: string[]; emails: string[]; extractionTemplate?: ExtractionTemplate | null }

/** תבנית לספק חוזר: regex לכל שדה (קבוצה 1 = הערך). נלמדת מהמסמך הראשון שאושר. */
export interface ExtractionTemplate { docNumber?: string; date?: string; gross?: string; vat?: string; net?: string }

export interface Extracted {
  supplierId?: string
  supplierName?: string
  docNumber?: string
  date?: string       // YYYY-MM-DD
  gross?: number
  vat?: number
  net?: number
  currency?: 'ILS' | 'USD' | 'EUR'
  /** 0–1: כמה שדות נמצאו ועד כמה הם מתיישבים (נטו+מע"מ=ברוטו). */
  confidence: number
  method: 'template' | 'rules' | 'llm' | 'manual'
  warnings: string[]
}

export type IntakeKind = 'invoice' | 'statement' | 'unknown'

const INVOICE_WORDS = /חשבונית|קבלה|invoice|receipt|חשבון עסקה|proforma/i
const STATEMENT_WORDS = /דף פירוט|פירוט חיובים|דף חשבון|statement|ישראכרט|isracard|מקס|max\b|כאל|cal\b|בנק|bank/i

/** ב.3 שלב 2 — סינון: ספק מוכר או מילות מפתח; דף פירוט/בנק → תור הייבוא (שלב 4). */
export function classifyIntake(input: { sender?: string; subject?: string; fileName?: string; text?: string }, suppliers: readonly KnownSupplier[]): IntakeKind {
  const hay = [input.subject, input.fileName, input.text?.slice(0, 2000)].filter(Boolean).join(' ')
  if (STATEMENT_WORDS.test(hay) && !INVOICE_WORDS.test(input.subject ?? '')) return 'statement'
  if (INVOICE_WORDS.test(hay)) return 'invoice'
  if (input.sender && findSupplier({ sender: input.sender }, suppliers)) return 'invoice'
  return 'unknown'
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/בע["״']?מ|ltd\.?|inc\.?|בעמ/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function findSupplier(input: { sender?: string; text?: string }, suppliers: readonly KnownSupplier[]): KnownSupplier | null {
  const senderEmail = input.sender?.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]?.toLowerCase()
  if (senderEmail) {
    const byEmail = suppliers.find((s) => s.emails.some((e) => e.toLowerCase() === senderEmail || (e.startsWith('@') && senderEmail.endsWith(e.toLowerCase()))))
    if (byEmail) return byEmail
  }
  const text = normalizeName(input.text ?? '')
  if (!text) return null
  for (const s of suppliers) {
    const names = [s.name, ...s.aliases].map(normalizeName).filter((n) => n.length >= 3)
    if (names.some((n) => text.includes(n))) return s
  }
  return null
}

const NUM = String.raw`(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)`
const toNum = (s: string | undefined) => (s === undefined ? undefined : Number(s.replace(/,/g, '')))
const DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g

function firstMatch(text: string, patterns: RegExp[]): number | undefined {
  for (const p of patterns) { const m = text.match(p); if (m?.[1]) return toNum(m[1]) }
  return undefined
}

/** ספק לא מוכר: השורה הראשונה במסמך שנראית כמו שם (אותיות, לא תאריך/מספר/כותרת מסמך). הצעה בלבד. */
export function guessSupplierName(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/).slice(0, 8)) {
    const line = raw.replace(/[\u200f\u200e]/g, '').trim()
    if (line.length < 3 || line.length > 60) continue
    if (!/\p{L}{3,}/u.test(line)) continue
    if (/חשבונית|קבלה|invoice|receipt|תאריך|לכבוד|date|סה["״']?כ|מע["״']?מ|@|www\.|\d{2}[./-]\d{2}[./-]\d{2,4}/i.test(line)) continue
    return line.replace(/\s+/g, ' ')
  }
  return undefined
}

/** חילוץ לפי כללים כלליים — עברית ואנגלית, פורמטים נפוצים של חשבוניות ישראליות. */
export function extractByRules(text: string, supplier?: KnownSupplier | null): Extracted {
  const t = text.replace(/‏|‎/g, '').replace(/[ \t]+/g, ' ')
  const warnings: string[] = []
  const gross = firstMatch(t, [
    new RegExp(String.raw`(?:סה["״']?כ לתשלום|לתשלום|סך הכל לתשלום|total due|amount due|grand total|total)\D{0,12}${NUM}`, 'i'),
    new RegExp(String.raw`${NUM}\s*₪?\s*(?:סה["״']?כ לתשלום|לתשלום)`, 'i'),
  ])
  // "לפני מע"מ 1,000" אינו מע"מ — lookbehind שולל.
  const vat = firstMatch(t, [new RegExp(String.raw`(?<!לפני\s)(?<!ללא\s)(?:מע["״']?מ(?:\s*\d{1,2}%)?|vat(?:\s*\d{1,2}%)?)\D{0,12}${NUM}`, 'i')])
  let net = firstMatch(t, [new RegExp(String.raw`(?:סה["״']?כ לפני מע["״']?מ|לפני מע["״']?מ|subtotal|סכום לפני|net)\D{0,12}${NUM}`, 'i')])
  // pdf-parse מחזיר לפעמים RTL הפוך ("7001 חשבונית מס") — שני הכיוונים.
  const docNumber = t.match(/(?:חשבונית מס(?:\s*\/\s*קבלה)?|חשבונית|קבלה|invoice|receipt)\s*(?:מס['׳]?\.?|no\.?|#|number)?\s*[:#]?\s*(\d{3,12})/i)?.[1]
    ?? t.match(/(\d{3,12})\s*(?:חשבונית מס|חשבונית|קבלה)/)?.[1]
  const dates: string[] = []
  for (const m of t.matchAll(DATE_RE)) {
    const [, d, mo, yRaw] = m
    const y = yRaw!.length === 2 ? `20${yRaw}` : yRaw!
    const dd = Number(d), mm = Number(mo)
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) dates.push(`${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)
  }
  const date = dates[0]
  if (net === undefined && gross !== undefined && vat !== undefined) net = Math.round((gross - vat) * 100) / 100
  const consistent = gross !== undefined && vat !== undefined && net !== undefined && Math.abs(net + vat - gross) <= 1
  if (gross !== undefined && vat !== undefined && net !== undefined && !consistent) warnings.push('נטו + מע"מ ≠ ברוטו')
  const found = [gross, date, docNumber].filter((x) => x !== undefined).length
  const confidence = Math.min(1, found / 3 * 0.7 + (consistent ? 0.3 : 0) + (supplier ? 0.1 : 0))
  const currency = /\$|usd/i.test(t) && !/₪|ש["״']?ח/.test(t) ? 'USD' : /€|eur/i.test(t) && !/₪/.test(t) ? 'EUR' : 'ILS'
  if (currency !== 'ILS') warnings.push(`מטבע ${currency} — לאמת סכום בש"ח`)
  return { supplierId: supplier?.id, supplierName: supplier?.name ?? guessSupplierName(t), docNumber, date, gross, vat, net, currency, confidence: Math.round(confidence * 100) / 100, method: 'rules', warnings }
}

/** תבנית ספק: regex לכל שדה. נכשל שדה → נופל לכללים הכלליים עבורו. */
export function extractByTemplate(text: string, supplier: KnownSupplier): Extracted {
  const tpl = supplier.extractionTemplate
  if (!tpl) return extractByRules(text, supplier)
  const base = extractByRules(text, supplier)
  const pick = (re?: string) => { if (!re) return undefined; try { return text.match(new RegExp(re, 'i'))?.[1] } catch { return undefined } }
  const gross = toNum(pick(tpl.gross)) ?? base.gross
  const vat = toNum(pick(tpl.vat)) ?? base.vat
  const net = toNum(pick(tpl.net)) ?? base.net
  const docNumber = pick(tpl.docNumber) ?? base.docNumber
  const rawDate = pick(tpl.date)
  const date = rawDate ? extractByRules(rawDate).date ?? base.date : base.date
  const hits = [tpl.gross && gross, tpl.date && date, tpl.docNumber && docNumber].filter(Boolean).length
  return { ...base, gross, vat, net, docNumber, date, method: 'template', confidence: Math.min(1, base.confidence + hits * 0.1) }
}

/**
 * לומדים תבנית מהמסמך הראשון שאושר ידנית: לכל ערך מאושר — הטקסט שלפניו (עד 25 תווים) הופך ל-regex.
 * זה מה שהופך ספק "לא מוכר" ל"מוכר" לפעם הבאה (ב.3).
 */
export function learnTemplate(text: string, verified: { docNumber?: string; date?: string; gross?: number; vat?: number; net?: number }): ExtractionTemplate {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fmtNum = (n: number) => [String(n), n.toLocaleString('en-US', { minimumFractionDigits: 2 }), n.toLocaleString('en-US')]
  const learn = (values: string[]): string | undefined => {
    for (const v of values) {
      const i = text.indexOf(v)
      if (i < 0) continue
      const before = text.slice(Math.max(0, i - 25), i).replace(/\d/g, '').trim().slice(-20)
      if (before.length < 3) continue
      return `${esc(before)}\\D{0,12}(${NUM.slice(1, -1)})`
    }
    return undefined
  }
  const learnDate = (): string | undefined => {
    if (!verified.date) return undefined
    const [y, m, d] = verified.date.split('-')
    const forms = [`${Number(d)}/${Number(m)}/${y}`, `${d}/${m}/${y}`, `${d}.${m}.${y}`, `${d}-${m}-${y}`]
    for (const v of forms) { const i = text.indexOf(v); if (i >= 0) { const before = text.slice(Math.max(0, i - 20), i).replace(/\d/g, '').trim(); if (before.length >= 3) return `${esc(before)}\\D{0,6}(\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4})` } }
    return undefined
  }
  return {
    gross: verified.gross !== undefined ? learn(fmtNum(verified.gross)) : undefined,
    vat: verified.vat !== undefined ? learn(fmtNum(verified.vat)) : undefined,
    net: verified.net !== undefined ? learn(fmtNum(verified.net)) : undefined,
    docNumber: verified.docNumber ? learn([verified.docNumber])?.replace(`(${NUM.slice(1, -1)})`, '(\\d{3,12})') : undefined,
    date: learnDate(),
  }
}

/** שם הקובץ בדרייב — ב.3 שלב 8: {תאריך}_{ספק}_{סכום}.pdf */
export function intakeFileName(e: Extracted, fallback: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  const supplier = e.supplierName ? safe(e.supplierName) : 'לא-מזוהה'
  return `${e.date ?? 'ללא-תאריך'}_${supplier}_${e.gross !== undefined ? e.gross.toFixed(2) : safe(fallback.replace(/\.\w+$/, ''))}.pdf`
}
