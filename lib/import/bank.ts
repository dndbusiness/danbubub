/**
 * ייבוא דף בנק — SPEC §4.2.
 * "CSV/XLSX: מיפוי עמודות לפי בנק … PDF: חילוץ טבלאות; תוצאה תמיד עוברת מסך אימות."
 *
 * טהור: שורות → תנועות בנק + יתרת סגירה. ההתאמה לתנועות קיימות ב-lib/match/invoices.ts,
 * הכתיבה ל-DB בשכבה שמעל.
 *
 * ⚠ מיפויי העמודות נכתבו לפי הייצוא הנפוץ של ארבעת הבנקים ו**לא אומתו מול קובץ אמיתי**
 * (שאלה פתוחה #1). ניתנים לעריכה ב-settings.bank_column_maps, כמו באשראי.
 */
import type { Cell } from './workbook.js'
import { toIsoDate, toNumber } from './workbook.js'

export interface BankColumnMap {
  id: string
  label: string
  /** מילות מפתח בכותרות שמזהות את הבנק (כולן חייבות להופיע). */
  detect: string[]
  date: string[]
  /** תאריך ערך — אם קיים, משמש ל-date_cash כשיש הפרש. */
  valueDate?: string[]
  description: string[]
  /** בנקים ישראליים: שתי עמודות נפרדות. */
  debit?: string[]
  credit?: string[]
  /** או עמודה אחת חתומה. */
  amount?: string[]
  balance?: string[]
  reference?: string[]
}

export const DEFAULT_BANK_MAPS: BankColumnMap[] = [
  {
    id: 'hapoalim', label: 'הפועלים',
    detect: ['תאריך', 'תיאור הפעולה', 'יתרה'],
    date: ['תאריך'], valueDate: ['תאריך ערך'], description: ['תיאור הפעולה', 'תיאור'],
    debit: ['חובה', 'בחובה'], credit: ['זכות', 'בזכות'], balance: ['יתרה'], reference: ['אסמכתא', 'אסמכתה'],
  },
  {
    id: 'leumi', label: 'לאומי',
    detect: ['תאריך', 'תיאור', 'היתרה בש'],
    date: ['תאריך'], valueDate: ['תאריך ערך'], description: ['תיאור', 'פירוט'],
    debit: ['בחובה'], credit: ['בזכות'], balance: ['היתרה בש', 'יתרה'], reference: ['אסמכתא'],
  },
  {
    id: 'discount', label: 'דיסקונט',
    detect: ['תאריך', 'תיאור התנועה', 'יתרה'],
    date: ['תאריך'], valueDate: ['תאריך ערך'], description: ['תיאור התנועה', 'תיאור'],
    debit: ['חובה'], credit: ['זכות'], balance: ['יתרה'], reference: ['אסמכתא', 'מספר תנועה'],
  },
  {
    id: 'mizrahi', label: 'מזרחי טפחות',
    detect: ['תאריך', 'פעולה', 'יתרה'],
    date: ['תאריך'], valueDate: ['תאריך ערך'], description: ['פעולה', 'תיאור'],
    debit: ['חובה'], credit: ['זכות'], balance: ['יתרה'], reference: ['אסמכתא'],
  },
  {
    // ייצוא גנרי: עמודת סכום אחת חתומה.
    id: 'generic', label: 'כללי (סכום חתום)',
    detect: ['תאריך', 'סכום'],
    date: ['תאריך', 'date'], description: ['תיאור', 'פירוט', 'description'],
    amount: ['סכום', 'amount'], balance: ['יתרה', 'balance'], reference: ['אסמכתא', 'reference'],
  },
]

const norm = (s: unknown) => String(s ?? '').replace(/[׳״'"]+/g, '').replace(/\s+/g, ' ').trim()

export function findBankHeaderRow(rows: Cell[][], maps: readonly BankColumnMap[] = DEFAULT_BANK_MAPS): { index: number; headers: string[]; map: BankColumnMap } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const headers = (rows[i] ?? []).map(norm)
    if (headers.filter(Boolean).length < 3) continue
    for (const map of maps) {
      if (map.detect.every((k) => headers.some((h) => h.includes(norm(k))))) return { index: i, headers, map }
    }
  }
  return null
}

function colIndex(headers: string[], candidates: string[] | undefined): number {
  if (!candidates) return -1
  for (const c of candidates) { const i = headers.findIndex((h) => h === norm(c)); if (i >= 0) return i }
  for (const c of candidates) { const i = headers.findIndex((h) => h.includes(norm(c))); if (i >= 0) return i }
  return -1
}

export interface BankRow {
  sourceRef: string
  /** תאריך הערך אם קיים, אחרת תאריך הפעולה — זה מה שנספר כ-date_cash. */
  date: string
  /** תאריך הפעולה כפי שמופיע בדף. */
  bookedDate: string
  description: string
  /** חתום: חיובי נכנס, שלילי יוצא. */
  amount: number
  balance?: number
  reference?: string
  rowIndex: number
}

export interface BankStatement {
  formatId: string
  formatLabel: string
  rows: BankRow[]
  dateFrom: string
  dateTo: string
  /** היתרה לפני השורה הראשונה, אם אפשר לגזור אותה. */
  openingBalance: number | null
  /** היתרה בשורה האחרונה בדף. */
  closingBalance: number | null
  /** SPEC §4.2 — "יתרת סגירה בדף = יתרה מחושבת?" */
  computedClosing: number | null
  balanceMatches: boolean | null
  balanceGap: number | null
  /** השורה הראשונה שבה היתרה המתגלגלת בדף לא מסתדרת — שם באמת חסרה או עודפת תנועה. */
  firstBalanceBreak: { rowIndex: number; description: string; expected: number; found: number } | null
  warnings: string[]
  skipped: number
}

export interface ParseBankOptions { maps?: readonly BankColumnMap[]; formatId?: string; defaultYear?: number }

export function parseBankStatement(rows: Cell[][], opts: ParseBankOptions = {}): BankStatement | { error: string } {
  const maps = opts.maps ?? DEFAULT_BANK_MAPS
  const found = opts.formatId
    ? (() => { const map = maps.find((m) => m.id === opts.formatId); if (!map) return null
        for (let i = 0; i < Math.min(rows.length, 20); i++) { const headers = (rows[i] ?? []).map(norm); if (colIndex(headers, map.date) >= 0) return { index: i, headers, map } }
        return null })()
    : findBankHeaderRow(rows, maps)
  if (!found) return { error: 'לא זוהה פורמט דף בנק: הכותרות לא תואמות להפועלים / לאומי / דיסקונט / מזרחי. אפשר להגדיר מיפוי בהגדרות.' }

  const { index, headers, map } = found
  const ix = {
    date: colIndex(headers, map.date), valueDate: colIndex(headers, map.valueDate), description: colIndex(headers, map.description),
    debit: colIndex(headers, map.debit), credit: colIndex(headers, map.credit), amount: colIndex(headers, map.amount),
    balance: colIndex(headers, map.balance), reference: colIndex(headers, map.reference),
  }
  if (ix.date < 0 || ix.description < 0) return { error: `פורמט ${map.label} זוהה אבל חסרה עמודת תאריך או תיאור` }
  if (ix.amount < 0 && ix.debit < 0 && ix.credit < 0) return { error: `פורמט ${map.label} זוהה אבל אין עמודת סכום (חובה/זכות או סכום)` }

  const warnings: string[] = []
  const out: BankRow[] = []
  let skipped = 0
  const year = opts.defaultYear ?? new Date().getUTCFullYear()

  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const bookedDate = toIsoDate(r[ix.date], year)
    const description = norm(r[ix.description])
    if (!bookedDate || !description) { if (r.some((c) => c !== null && c !== undefined && c !== '')) skipped++; continue }
    if (/^סה.?כ|^יתרת (פתיחה|סגירה)|total/i.test(description)) { skipped++; continue }

    let amount: number | null = null
    if (ix.amount >= 0) amount = toNumber(r[ix.amount])
    else {
      const debit = ix.debit >= 0 ? toNumber(r[ix.debit]) : null
      const credit = ix.credit >= 0 ? toNumber(r[ix.credit]) : null
      if (debit !== null && debit !== 0) amount = -Math.abs(debit)
      else if (credit !== null && credit !== 0) amount = Math.abs(credit)
    }
    if (amount === null || amount === 0) { skipped++; continue }

    const valueDate = ix.valueDate >= 0 ? toIsoDate(r[ix.valueDate], year) : null
    const reference = ix.reference >= 0 ? norm(r[ix.reference]) || undefined : undefined
    const balance = ix.balance >= 0 ? toNumber(r[ix.balance]) ?? undefined : undefined
    out.push({
      sourceRef: `bank:${map.id}:${reference ?? description}:${bookedDate}:${amount}`,
      date: valueDate ?? bookedDate, bookedDate, description, amount: Math.round(amount * 100) / 100,
      balance, reference, rowIndex: i + 1,
    })
  }
  if (!out.length) return { error: 'לא נמצאו שורות תנועה בדף' }

  // dedup בתוך הקובץ עצמו
  const seen = new Set<string>()
  const unique = out.filter((r) => {
    if (seen.has(r.sourceRef)) { warnings.push(`כפילות בדף: ${r.description} ${r.bookedDate} ${r.amount}`); return false }
    seen.add(r.sourceRef); return true
  })

  const dates = unique.map((r) => r.date).sort()
  const first = unique[0]
  const last = unique.at(-1)
  const closingBalance = last?.balance ?? null
  // יתרת פתיחה: היתרה אחרי השורה הראשונה פחות הסכום שלה.
  const openingBalance = first?.balance !== undefined ? Math.round((first.balance - first.amount) * 100) / 100 : null
  const total = Math.round(unique.reduce((a, r) => a + r.amount, 0) * 100) / 100
  const computedClosing = openingBalance !== null ? Math.round((openingBalance + total) * 100) / 100 : null
  const balanceGap = computedClosing !== null && closingBalance !== null ? Math.round((closingBalance - computedClosing) * 100) / 100 : null
  // היתרה המתגלגלת: כל שורה עם יתרה חייבת להיות הקודמת + הסכום שלה.
  // שבירה באמצע הדף = שורה חסרה או עודפת, וזה מדויק יותר מהפרש בסוף.
  let firstBalanceBreak: BankStatement['firstBalanceBreak'] = null
  let running = openingBalance
  for (const r of unique) {
    if (running === null) break
    running = Math.round((running + r.amount) * 100) / 100
    if (r.balance === undefined) continue
    if (Math.abs(r.balance - running) >= 0.01) {
      if (!firstBalanceBreak) firstBalanceBreak = { rowIndex: r.rowIndex, description: r.description, expected: running, found: r.balance }
      running = r.balance // ממשיכים מהיתרה שבדף, כדי לא להציף שגיאות
    }
  }
  const balanceMatches = balanceGap === null ? null : Math.abs(balanceGap) < 0.01 && !firstBalanceBreak
  if (balanceGap !== null && Math.abs(balanceGap) >= 0.01) warnings.push(`יתרת הסגירה בדף (${closingBalance}) שונה מהמחושבת (${computedClosing}) ב-${balanceGap} ₪`)
  if (firstBalanceBreak) warnings.push(`היתרה נשברת בשורה ${firstBalanceBreak.rowIndex} ("${firstBalanceBreak.description}"): בדף ${firstBalanceBreak.found}, מחושב ${firstBalanceBreak.expected}`)
  if (balanceMatches === null) warnings.push('אין עמודת יתרה — אי אפשר לאמת את יתרת הסגירה (§4.2)')

  return {
    formatId: map.id, formatLabel: map.label, rows: unique,
    dateFrom: dates[0]!, dateTo: dates.at(-1)!,
    openingBalance, closingBalance, computedClosing, balanceMatches, balanceGap, firstBalanceBreak,
    warnings, skipped,
  }
}
