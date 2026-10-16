/**
 * ייבוא חשבונית ירוקה — SPEC §4.3.
 * "פורמט ייצוא הוצאות (מאומת מקובץ אמיתי, 291 שורות): CSV, UTF-8 עם BOM, 14 עמודות."
 *
 * טהור. שני כללים שהאפיון מדגיש:
 *   1. **תמיד** לוקחים "סכום הוצאה עסקית" ו"מע״מ הוצאה עסקית" (כבר בש"ח), לא את הסכום המקורי.
 *   2. dedup לפי (מספר מסמך, ספק, סכום כולל) — הקובץ האמיתי מכיל כפילויות; מסמנים ולא מייבאים פעמיים.
 */
import type { Cell } from './workbook.js'
import { toIsoDate, toNumber } from './workbook.js'
import { normalizeName } from '../intake/extract.js'

export type GreenInvoiceDirection = 'received' | 'issued'

/** §4.3 — סוגי המסמך. זיכוי = סכום שלילי. */
export const GI_DOC_TYPES = ['חשבונית מס', 'חשבונית מס / קבלה', 'קבלה', 'חשבון / אישור תשלום', 'חשבונית זיכוי'] as const

const DOC_TYPE_MAP: Record<string, string> = {
  'חשבונית מס': 'invoice',
  'חשבונית מס / קבלה': 'invoice_receipt',
  'קבלה': 'receipt',
  'חשבון / אישור תשלום': 'payment_confirmation',
  'חשבונית זיכוי': 'credit_note',
}

const norm = (s: unknown) => String(s ?? '').replace(/^﻿/, '').replace(/[׳״'"]+/g, '').replace(/\s+/g, ' ').trim()

/** הכותרות של הייצוא, בסדר שהאפיון מתעד. ההתאמה לפי הכלה, כדי לסבול שינויי ניסוח קלים. */
const COLUMNS = {
  docNumber: ['מספר המסמך', 'מספר מסמך'],
  docDate: ['תאריך המסמך', 'תאריך מסמך'],
  vatPeriod: ['חודש דיווח'],
  docType: ['סוג המסמך', 'סוג מסמך'],
  supplier: ['ספק', 'לקוח'],
  expenseAccount: ['חשבון הוצאה', 'חשבון'],
  description: ['תיאור'],
  gross: ['סכום כולל מעמ'],
  vat: ['מעמ'],
  net: ['סכום לא כולל מעמ'],
  currency: ['מטבע'],
  businessGross: ['סכום הוצאה עסקית'],
  businessVat: ['מעמ הוצאה עסקית'],
  status: ['סטטוס'],
} as const

export function findGreenInvoiceHeader(rows: Cell[][]): { index: number; headers: string[] } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const headers = (rows[i] ?? []).map(norm)
    const hasDoc = headers.some((h) => h.includes('מספר המסמך') || h.includes('מספר מסמך'))
    const hasType = headers.some((h) => h.includes('סוג המסמך') || h.includes('סוג מסמך'))
    if (hasDoc && hasType) return { index: i, headers }
  }
  return null
}

function col(headers: string[], candidates: readonly string[]): number {
  for (const c of candidates) { const i = headers.findIndex((h) => h === norm(c)); if (i >= 0) return i }
  for (const c of candidates) { const i = headers.findIndex((h) => h.includes(norm(c))); if (i >= 0) return i }
  return -1
}

export interface GreenInvoiceRow {
  sourceRef: string
  docNumber: string
  docDate: string
  /** §4.3 — "חודש דיווח ≠ חודש המסמך לפעמים — זה חודש המע"מ." */
  vatPeriod: string | null
  docType: string
  docTypeLabel: string
  supplier: string
  supplierNormalized: string
  expenseAccount: string | null
  description: string | null
  /** בש"ח, אחרי המרה — "סכום הוצאה עסקית". חתום: זיכוי שלילי. */
  gross: number
  vat: number
  net: number
  currency: string
  /** הסכום במטבע המקורי, לתצוגה בלבד. */
  originalGross: number | null
  /** §4.3 — "הוצאה פתוחה" = טרם אושרה/דווחה. */
  reported: boolean
  status: string
  possibleDuplicate: boolean
  rowIndex: number
}

export interface GreenInvoiceExport {
  direction: GreenInvoiceDirection
  rows: GreenInvoiceRow[]
  /** שורות שזוהו ככפילות של שורה קודמת באותו קובץ. */
  duplicates: GreenInvoiceRow[]
  warnings: string[]
  skipped: number
  totals: { gross: number; vat: number; reported: number; open: number }
}

export interface ParseGreenInvoiceOptions {
  direction?: GreenInvoiceDirection
  defaultYear?: number
  /** §4.3 — ספקים שהם ישויות של השותפים; חשבונית מהם אינה הוצאה. */
  partnerSuppliers?: readonly string[]
}

/** §4.3 — "ספק ∈ {די.אנד.די, אביב, ניסים} → nature=draw … ודורש אישור." */
export const DEFAULT_PARTNER_SUPPLIERS = ['די.אנד.די', 'די אנד די', 'd&d', 'dnd']

export function isPartnerSupplier(supplier: string, partners: readonly string[] = DEFAULT_PARTNER_SUPPLIERS): boolean {
  const n = normalizeName(supplier)
  return partners.some((p) => n.includes(normalizeName(p)))
}

export function parseGreenInvoiceExport(rows: Cell[][], opts: ParseGreenInvoiceOptions = {}): GreenInvoiceExport | { error: string } {
  const header = findGreenInvoiceHeader(rows)
  if (!header) return { error: 'לא זוהה ייצוא של חשבונית ירוקה: חסרות העמודות "מספר המסמך" ו"סוג המסמך".' }
  const { index, headers } = header
  const ix = Object.fromEntries(Object.entries(COLUMNS).map(([k, v]) => [k, col(headers, v)])) as Record<keyof typeof COLUMNS, number>
  if (ix.docNumber < 0 || ix.docDate < 0) return { error: 'ייצוא חשבונית ירוקה זוהה אבל חסרה עמודת מספר או תאריך מסמך' }

  const direction = opts.direction ?? 'received'
  const year = opts.defaultYear ?? new Date().getUTCFullYear()
  const warnings: string[] = []
  const all: GreenInvoiceRow[] = []
  let skipped = 0

  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const docNumber = norm(r[ix.docNumber])
    const docDate = toIsoDate(r[ix.docDate], year)
    if (!docNumber || !docDate) { if (r.some((c) => c !== null && c !== undefined && c !== '')) skipped++; continue }

    const docTypeRaw = norm(r[ix.docType])
    const supplier = norm(r[ix.supplier])
    const currency = norm(r[ix.currency]) || 'ILS'
    const isCredit = docTypeRaw.includes('זיכוי')
    const sign = isCredit ? -1 : 1

    // §4.3 — תמיד הסכום העסקי (כבר בש"ח). נופלים לסכום הרגיל רק כשהעמודה חסרה.
    const businessGross = ix.businessGross >= 0 ? toNumber(r[ix.businessGross]) : null
    const businessVat = ix.businessVat >= 0 ? toNumber(r[ix.businessVat]) : null
    const rawGross = ix.gross >= 0 ? toNumber(r[ix.gross]) : null
    const rawVat = ix.vat >= 0 ? toNumber(r[ix.vat]) : null
    const rawNet = ix.net >= 0 ? toNumber(r[ix.net]) : null
    if (businessGross === null && rawGross === null) { skipped++; continue }
    if (businessGross === null && currency !== 'ILS') warnings.push(`שורה ${i + 1}: מטבע ${currency} בלי "סכום הוצאה עסקית" — נלקח הסכום המקורי`)

    const gross = sign * Math.abs(businessGross ?? rawGross ?? 0)
    const vat = sign * Math.abs(businessVat ?? rawVat ?? 0)
    const net = businessGross !== null ? Math.round((gross - vat) * 100) / 100 : sign * Math.abs(rawNet ?? Math.round((Math.abs(gross) - Math.abs(vat)) * 100) / 100)

    const vatPeriodRaw = ix.vatPeriod >= 0 ? norm(r[ix.vatPeriod]) : ''
    const m = vatPeriodRaw.match(/(\d{1,2})[./-](\d{4})/)
    const status = ix.status >= 0 ? norm(r[ix.status]) : ''

    all.push({
      sourceRef: `gi:${direction}:${docNumber}:${normalizeName(supplier)}:${Math.abs(gross).toFixed(2)}`,
      docNumber, docDate,
      vatPeriod: m ? `${m[2]}-${m[1]!.padStart(2, '0')}` : null,
      docType: DOC_TYPE_MAP[docTypeRaw] ?? 'other', docTypeLabel: docTypeRaw,
      supplier, supplierNormalized: normalizeName(supplier),
      expenseAccount: ix.expenseAccount >= 0 ? norm(r[ix.expenseAccount]) || null : null,
      description: ix.description >= 0 ? norm(r[ix.description]) || null : null,
      gross, vat, net, currency,
      originalGross: currency !== 'ILS' && rawGross !== null ? sign * Math.abs(rawGross) : null,
      reported: status.includes('מדווחת'), status,
      possibleDuplicate: false,
      rowIndex: i + 1,
    })
  }
  if (!all.length) return { error: 'לא נמצאו שורות מסמך בקובץ' }

  // §4.3 — dedup לפי (מספר מסמך, ספק, סכום כולל): מסמנים, לא מוחקים.
  const seen = new Map<string, GreenInvoiceRow>()
  const duplicates: GreenInvoiceRow[] = []
  for (const row of all) {
    const prev = seen.get(row.sourceRef)
    if (prev) { row.possibleDuplicate = true; duplicates.push(row); continue }
    seen.set(row.sourceRef, row)
  }
  if (duplicates.length) warnings.push(`${duplicates.length} כפילויות בקובץ (אותו מסמך, ספק וסכום) — מסומנות ולא מיובאות פעמיים`)

  const unique = [...seen.values()]
  const partnerRows = unique.filter((r) => isPartnerSupplier(r.supplier, opts.partnerSuppliers))
  if (partnerRows.length) warnings.push(`${partnerRows.length} מסמכים מספק שהוא ישות של שותף — אינם הוצאה (משיכה/התחשבנות, §4.3); דורשים אישור`)

  return {
    direction, rows: unique, duplicates, warnings, skipped,
    totals: {
      gross: Math.round(unique.reduce((a, r) => a + r.gross, 0) * 100) / 100,
      vat: Math.round(unique.reduce((a, r) => a + r.vat, 0) * 100) / 100,
      reported: unique.filter((r) => r.reported).length,
      open: unique.filter((r) => !r.reported).length,
    },
  }
}

/**
 * §4.3 — "כל category שלנו ממופה למפתח חשבון של חשבונית ירוקה בהגדרות".
 * הרשימה מהאפיון; משמשת את הפלט לרו"ח (§7).
 */
export const GI_ACCOUNT_KEYS: Record<string, string> = {
  '3011': 'שכר עבודה', '3012': 'נלוות לשכר', '3540': 'הנהלת חשבונות', '3560': 'נסיעות', '3570': 'שכירות',
  '3575': 'ארנונה ומיסים', '3590': 'חשמל ומים', '3625': 'כיבודים 80%', '3650': 'תקשורת', '3680': 'תוכנה', '1390': 'עלויות אחרות',
}
