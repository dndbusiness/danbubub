/**
 * פורמט תצוגה — UIUX §2.2.
 * "₪ תמיד אחרי המספר, עם רווח דק. שליליים: −12,000 ₪ (מינוס אמיתי).
 *  אגורות מוסתרות בכרטיסים, מוצגות בטבלאות."
 *
 * <Money> הוא הרכיב היחיד שמדפיס סכום (UIUX §4.3) — הפונקציות כאן משרתות אותו,
 * ואת ייצוא ה-XLSX/PDF שלא עובר דרך React.
 */

import { round2 } from '@/lib/rules/money.js'

const MINUS = '−' // מינוס אמיתי, לא מקף

const withCents = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const noCents = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export function formatMoney(value: number, opts: { cents?: boolean } = {}): string {
  const rounded = round2(value)
  const fmt = opts.cents === false ? noCents : withCents
  const abs = fmt.format(Math.abs(rounded))
  return `${rounded < 0 ? MINUS : ''}${abs} ₪`
}

/** תאריך ISO → dd/mm/yyyy. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** חודש YYYY-MM → MM/YYYY (UIUX §4.7 ציר X: "09/26"). */
export function formatMonth(month: string, opts: { short?: boolean } = {}): string {
  const [y, m] = month.split('-')
  return opts.short ? `${m}/${y!.slice(2)}` : `${m}/${y}`
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export const NATURE_LABELS: Record<string, string> = {
  income: 'הכנסה',
  expense: 'הוצאה',
  financing: 'מימון',
  transfer: 'העברה',
  advance: 'מקדמה',
  draw: 'משיכת שותף',
  vat: 'מע"מ',
  tax: 'מס',
}

export const DIVISION_LABELS: Record<string, string> = {
  realestate: 'נדל"ן',
  finance: 'מימון',
  shared: 'משותף',
  private: 'פרטי',
}

export const CERTAINTY_LABELS: Record<string, string> = {
  actual: 'בפועל',
  committed: 'ודאי',
  expected: 'פוטנציאל',
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  has_invoice: 'יש חשבונית',
  missing: 'חסרה',
  no_invoice_needed: 'לא נדרשת',
  unknown: 'לא ידוע',
}

export const COLLECTION_STATUS_LABELS: Record<string, string> = {
  not_collected: 'לא נגבה',
  advance_paid: 'שולם מקדמה',
  partially_paid: 'שולם חלקית',
  fully_paid: 'שולם במלואו',
  legal_collection: 'גביה משפטית',
  cancelled: 'מבוטל',
}

export const FINANCE_STAGE_LABELS: Record<string, string> = {
  prospect: 'לקוח פוטנציאלי',
  signed_collecting_docs: 'חתם / איסוף מסמכים',
  submitted: 'הוגש לגוף מממן',
  approved_in_principle: 'אישור עקרוני',
  appraisal: 'שמאות',
  lawyer_signing: 'חתימה אצל עו"ד',
  execution: 'ביצוע',
  completed: 'הושלמה העסקה',
}

export const PRODUCT_LABELS: Record<string, string> = {
  mortgage_declined: 'משכנתא (מסורבים)',
  business_credit: 'אשראי עסקי',
  vehicle_lien: 'שעבוד רכב',
  other: 'אחר',
  presale: 'פריסייל',
  secondhand: 'יד שנייה',
}

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  ok: 'תקין',
  ask_nissim: 'לשאול את ניסים',
  ask_aviv: 'לשאול את אביב',
  ask_yoni: 'לשאול את יוני',
  unknown_expense: 'לא מזוהה',
}

export const FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'חודשי',
  quarterly: 'רבעוני',
  yearly: 'שנתי',
  once: 'חד-פעמי',
}
