/**
 * ייבוא כרטיס אשראי — SPEC §4.1.
 *
 * "תמיכה בפורמטים של ישראכרט, מקס, כאל (מיפוי עמודות בהגדרות; זיהוי אוטומטי
 *  לפי כותרות). כל קובץ → תנועת-אב אחת (החיוב בבנק) + בנות. dedup לפי
 *  source_ref (מס' עסקה + תאריך + סכום)."
 *
 * טהור: מקבל שורות (כפי ש-SheetJS מחזיר) ומיפוי עמודות, מחזיר אב + בנות.
 * המיפויים המובנים הם נקודת פתיחה **לאימות מול קובץ אמיתי** (שאלה פתוחה #1);
 * הם ניתנים לעריכה בהגדרות (settings.import_column_maps) ולא מקודדים במסך.
 */

import type { Cell } from './workbook.js'
import { toIsoDate, toNumber } from './workbook.js'

export interface ColumnMap {
  /** מזהה הפורמט: isracard / max / cal / custom */
  id: string
  label: string
  /** מילות מפתח בכותרות שמזהות את הפורמט (כולן חייבות להופיע). */
  detect: string[]
  /** כותרות (או חלקי כותרת) לכל שדה. */
  date: string[]
  merchant: string[]
  amountCharged: string[]
  /** סכום העסקה המקורי (מט"ח / תשלומים) — אופציונלי. */
  amountOriginal?: string[]
  /** מזהה עסקה / אסמכתא — ל-dedup. */
  reference?: string[]
  category?: string[]
  notes?: string[]
  /** 4 ספרות אחרונות של הכרטיס, אם יש עמודה. */
  cardLast4?: string[]
}

/**
 * מיפויי ברירת מחדל — לפי כותרות הייצוא הנפוצות של שלוש החברות.
 * ⚠ לא אומתו מול קובץ אמיתי (שאלה #1). עריכה: settings.import_column_maps.
 */
export const DEFAULT_COLUMN_MAPS: ColumnMap[] = [
  {
    id: 'isracard', label: 'ישראכרט', detect: ['תאריך עסקה', 'שם בית עסק', 'סכום חיוב'],
    date: ['תאריך עסקה'], merchant: ['שם בית עסק', 'שם בית העסק'], amountCharged: ['סכום חיוב'],
    amountOriginal: ['סכום עסקה'], reference: ['מספר שובר', 'אסמכתא'], notes: ['פירוט נוסף', 'הערות'],
  },
  {
    id: 'max', label: 'מקס', detect: ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'],
    date: ['תאריך עסקה'], merchant: ['שם בית העסק'], amountCharged: ['סכום חיוב'],
    amountOriginal: ['סכום עסקה מקורי', 'סכום עסקה'], category: ['קטגוריה'], cardLast4: ['4 ספרות אחרונות של כרטיס האשראי', '4 ספרות'],
    notes: ['הערות', 'סוג עסקה'],
  },
  {
    id: 'cal', label: 'כאל', detect: ['תאריך העסקה', 'שם בית העסק', 'סכום החיוב'],
    date: ['תאריך העסקה'], merchant: ['שם בית העסק'], amountCharged: ['סכום החיוב'],
    amountOriginal: ['סכום העסקה'], reference: ['מספר אישור', 'אסמכתא'], notes: ['הערות', 'סוג העסקה'],
  },
]

export interface CardChildTx {
  /** מס' עסקה + תאריך + סכום — SPEC §4.1 מפתח ה-dedup. */
  sourceRef: string
  date: string
  merchant: string
  amount: number
  amountOriginal?: number
  reference?: string
  categoryHint?: string
  notes?: string
  cardLast4?: string
  rowIndex: number
}

export interface CardStatement {
  formatId: string
  formatLabel: string
  billingDate: string
  /** תנועת האב — החיוב בבנק ביום החיוב. שלילי (יוצא). */
  parentAmount: number
  children: CardChildTx[]
  warnings: string[]
  /** שורות שדולגו (ריקות/סיכום) — לשקיפות במסך האישור. */
  skipped: number
}

const norm = (s: unknown) => String(s ?? '').replace(/[׳״'"]+/g, '').replace(/\s+/g, ' ').trim()

/** מוצא את שורת הכותרת (לא תמיד הראשונה — יש קבצים עם כותרת-על) ומחזיר אינדקס+כותרות. */
export function findHeaderRow(rows: Cell[][], maps: readonly ColumnMap[] = DEFAULT_COLUMN_MAPS): { index: number; headers: string[]; map: ColumnMap } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const headers = (rows[i] ?? []).map(norm)
    for (const map of maps) {
      if (map.detect.every((k) => headers.some((h) => h.includes(norm(k))))) return { index: i, headers, map }
    }
  }
  return null
}

function colIndex(headers: string[], candidates: string[] | undefined): number {
  if (!candidates) return -1
  for (const c of candidates) {
    const i = headers.findIndex((h) => h === norm(c))
    if (i >= 0) return i
  }
  for (const c of candidates) {
    const i = headers.findIndex((h) => h.includes(norm(c)))
    if (i >= 0) return i
  }
  return -1
}

export interface ParseCardOptions {
  /** יום החיוב בבנק — SPEC §2.1 accounts.billing_day; אם לא ידוע, נגזר מהתאריך המאוחר בקובץ. */
  billingDate?: string
  maps?: readonly ColumnMap[]
  /** כפיית פורמט במקום זיהוי אוטומטי. */
  formatId?: string
  defaultYear?: number
}

export function parseCardStatement(rows: Cell[][], opts: ParseCardOptions = {}): CardStatement | { error: string } {
  const maps = opts.maps ?? DEFAULT_COLUMN_MAPS
  const found = opts.formatId
    ? (() => { const map = maps.find((m) => m.id === opts.formatId); if (!map) return null
        for (let i = 0; i < Math.min(rows.length, 15); i++) { const headers = (rows[i] ?? []).map(norm); if (colIndex(headers, map.date) >= 0 && colIndex(headers, map.amountCharged) >= 0) return { index: i, headers, map } }
        return null })()
    : findHeaderRow(rows, maps)
  if (!found) return { error: 'לא זוהה פורמט: הכותרות לא תואמות לישראכרט / מקס / כאל. אפשר להגדיר מיפוי בהגדרות.' }

  const { index, headers, map } = found
  const ix = {
    date: colIndex(headers, map.date), merchant: colIndex(headers, map.merchant), amount: colIndex(headers, map.amountCharged),
    original: colIndex(headers, map.amountOriginal), ref: colIndex(headers, map.reference), cat: colIndex(headers, map.category),
    notes: colIndex(headers, map.notes), last4: colIndex(headers, map.cardLast4),
  }
  const warnings: string[] = []
  if (ix.date < 0 || ix.amount < 0 || ix.merchant < 0) return { error: `פורמט ${map.label} זוהה אבל חסרה עמודה חובה (תאריך/בית עסק/סכום חיוב)` }

  const children: CardChildTx[] = []
  let skipped = 0
  const year = opts.defaultYear ?? new Date().getUTCFullYear()
  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const date = toIsoDate(r[ix.date], year)
    const amount = toNumber(r[ix.amount])
    const merchant = norm(r[ix.merchant])
    if (!date || amount === null || !merchant) { if (r.some((c) => c !== null && c !== undefined && c !== '')) skipped++; continue }
    // שורת סיכום ("סה"כ") — לא עסקה
    if (/סה.?כ|total/i.test(merchant)) { skipped++; continue }
    const reference = ix.ref >= 0 ? norm(r[ix.ref]) || undefined : undefined
    // בדף החיוב סכום חיובי = הוצאה; במערכת הוצאה שלילית. זיכוי (שלילי בדף) נשאר חיובי.
    const signed = -amount
    children.push({
      sourceRef: `card:${map.id}:${reference ?? merchant}:${date}:${amount}`,
      date, merchant, amount: Math.round(signed * 100) / 100,
      amountOriginal: ix.original >= 0 ? toNumber(r[ix.original]) ?? undefined : undefined,
      reference, categoryHint: ix.cat >= 0 ? norm(r[ix.cat]) || undefined : undefined,
      notes: ix.notes >= 0 ? norm(r[ix.notes]) || undefined : undefined,
      cardLast4: ix.last4 >= 0 ? norm(r[ix.last4]).slice(-4) || undefined : undefined,
      rowIndex: i + 1,
    })
  }
  if (!children.length) return { error: 'לא נמצאו שורות עסקה בקובץ' }

  // dedup בתוך הקובץ עצמו
  const seen = new Set<string>()
  const unique = children.filter((c) => { if (seen.has(c.sourceRef)) { warnings.push(`כפילות בקובץ: ${c.merchant} ${c.date} ${c.amount}`); return false } seen.add(c.sourceRef); return true })

  const last = unique.map((c) => c.date).sort().at(-1)!
  const billingDate = opts.billingDate ?? last
  const parentAmount = Math.round(unique.reduce((a, c) => a + c.amount, 0) * 100) / 100
  // זיכויים (החזרים) — סכום חיובי בחיוב הכרטיס; מותר, אבל מציינים
  const credits = unique.filter((c) => c.amount > 0).length
  if (credits) warnings.push(`${credits} זיכויים בקובץ`)

  return { formatId: map.id, formatLabel: map.label, billingDate, parentAmount, children: unique, warnings, skipped }
}
