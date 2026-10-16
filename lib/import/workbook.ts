/**
 * ייבוא חד-פעמי מהקובץ הקיים — "הר-אל-פתרונות-מימון-עסקי-דשבורד-ניסים-2026".
 * SPEC §9 שלב 2: "ייבוא חד-פעמי מהקובץ הקיים (28 עסקאות, הוצאות, מקדמות)";
 * קריטריון הסיום: "הקובץ הישן מוקפא לקריאה בלבד". SPEC נספח א — המיפוי.
 *
 * הפונקציות כאן טהורות: מקבלות את הגיליונות כמערכי שורות (כפי ש-SheetJS מחזיר
 * עם `sheet_to_json({header:1})`) ומחזירות רשומות מנורמלות + אזהרות.
 * הקריאה מהקובץ וכתיבה ל-DB — ב-scripts/import-workbook.mjs.
 *
 * מה שהקובץ עושה בשקט ואנחנו מציפים במקום להעלים:
 *   • תקבול בלי חודש (עמודה S ריקה) — הקובץ לא סופר אותו (ליקוי #2). אנחנו
 *     מייבאים אותו עם review_status='ask_nissim' ותאריך = יום הייבוא.
 *   • מספר שהוקלד ידנית במקום נוסחה (למשל הוצאות ישירות יולי) — אין לו
 *     שורות. מיובא כהוצאה בלי תיק, מסומן לבדיקה (ליקוי #1).
 *   • "הוצאות מוכרות" בקובץ = עמודה E="כן". הדס מסומנת "לא" → deductible=false.
 */

export type Cell = string | number | Date | null | undefined

export interface WorkbookSheets {
  deals: Cell[][]
  expenses: Cell[][]
  advances: Cell[][]
  /** "כרטיס ניסים" — לאימות בלבד: מה הקובץ חישב. */
  nissimCard?: Cell[][]
}

export interface ImportedDeal {
  sourceRef: string
  clientName: string
  product: string
  stage: string
  status: 'open' | 'won' | 'lost' | 'cancelled'
  collectionStatus: string
  feeAgreedNet: number
  feeMode: 'fixed' | 'pct_of_credit'
  feePct?: number
  baseAmount?: number
  monthAttributed?: string
  expectedCollectionDate?: string
  lenders: string[]
  approvedBy?: string
  notes?: string
  /** "פרייבט 1%" — הכנסות פרייבט מקרן, לא של החברה (SPEC §2.1 private_income). */
  privateOnePct?: number
  privateHalfPct?: number
  /** "הוצאות ישירות-לתשלום הלקוח" — הלקוח משלם; לא הוצאה שלנו. */
  clientPayableCosts?: number
}

export interface ImportedTransaction {
  sourceRef: string
  dateCash: string
  amountNet: number
  nature: 'income' | 'expense'
  dealSourceRef?: string
  categoryName?: string
  counterparty?: string
  description?: string
  deductible?: boolean
  reviewStatus?: 'ok' | 'ask_nissim' | 'unknown_expense'
  /** חודש ההתחשבנות שהקובץ ייחס לשורה, אם צוין. */
  monthFromFile?: string
}

export interface ImportedAdvance {
  sourceRef: string
  date: string
  amountGross: number
  method: 'cash' | 'credit_card' | 'transfer'
  period: string
  note?: string
}

export interface ImportWarning {
  sourceRef: string
  kind:
    | 'receipt_without_month'
    | 'manual_number_no_rows'
    | 'unparseable_amount'
    | 'missing_date'
    | 'deal_without_client'
    | 'text_in_numeric_cell'
  message: string
}

export interface ImportBundle {
  year: number
  deals: ImportedDeal[]
  transactions: ImportedTransaction[]
  advances: ImportedAdvance[]
  warnings: ImportWarning[]
  /** מה הקובץ עצמו חישב בכרטיס ניסים, לפי חודש — לאימות מול המערכת. */
  fileNissimCard: Array<{ month: string; income: number; deductible: number; direct: number; profit: number; advances: number; balance: number }>
}

// ── מיפויים (SPEC §2.3 + הגדרות בקובץ) ──────────────────────────────────────

/** "מיקום בתהליך" → deals.stage (שלבי תיק מימון, SPEC §2.3). */
const STAGE_MAP: Record<string, string> = {
  'לקוח פוטנציאלי': 'prospect',
  'לקוח חתם - איסוף מסמכים': 'signed_collecting_docs',
  'הוגש לגוף מממן': 'submitted',
  'אישור עקרוני': 'approved_in_principle',
  'שמאות': 'appraisal',
  "חתימה אצל עו′′ד וצאק פיקדון": 'lawyer_signing',
  'ביצוע': 'execution',
  'הושלמה העסקה': 'completed',
}

/** "סטטוס פתוח" → collection_status (SPEC §2.3 רשימה מתוקנת). */
const COLLECTION_MAP: Record<string, string> = {
  'עסקה הושלמה': 'fully_paid',
  'בתהליך גביה': 'not_collected',
  "שולם (העברה כ′′א צ′אק)": 'fully_paid',
  'גביה פעילה טיפול משפטי': 'legal_collection',
  'על בסיס הצלחה': 'not_collected',
  'שולם חלק וחלק שני על בסיס הצלחה': 'partially_paid',
  'נדחה': 'cancelled',
}

/** "תהליך שנסגר" → product (SPEC §2.1). */
const PRODUCT_MAP: Record<string, string> = {
  'משכנתא חוץ-בנקאית': 'mortgage_declined',
  'משכנתא חדשה': 'mortgage_declined',
  'מיחזור': 'mortgage_declined',
  'הלוואה חוץ-בנקאית': 'business_credit',
  'הלוואה עסקית חוץ בנקאית': 'business_credit',
  'הלוואה ערבות המדינה': 'business_credit',
  'ליווי עסקה': 'business_credit',
  'הלוואת שיפוץ בנקאי': 'business_credit',
  'הלוואת רכב': 'vehicle_lien',
}

// ── עזרים ──────────────────────────────────────────────────────────────────

const norm = (s: string) => s.replace(/[′'"]+/g, "'").replace(/\s+/g, ' ').trim()

function mapBy(map: Record<string, string>, v: Cell, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const key = norm(v)
  for (const [k, val] of Object.entries(map)) if (norm(k) === key) return val
  return fallback
}

export function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.replace(/[₪,\s]/g, '').replace(/ש"ח|שח/g, '')
    if (!cleaned) return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** תאריך: Date / "12.07.26" / "10.7.26" / ISO. */
export function toIsoDate(v: Cell, defaultYear: number): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    // מספר סידורי של Excel
    const ms = Math.round((v - 25569) * 86_400_000)
    return new Date(ms).toISOString().slice(0, 10)
  }
  if (typeof v !== 'string') return null
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return `${y}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  }
  void defaultYear
  return null
}

function monthKey(year: number, m: Cell): string | undefined {
  const n = toNumber(m)
  if (n === null || n < 1 || n > 12) return undefined
  return `${year}-${String(Math.round(n)).padStart(2, '0')}`
}

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(d).padStart(2, '0')}`
}

// ── הפרסור ─────────────────────────────────────────────────────────────────

export interface ParseOptions {
  year: number
  /** יום הייבוא — תאריך לתקבולים שהקובץ לא ציין להם חודש. */
  importDate: string
}

/** עמודות גיליון "עסקאות" (0-based), לפי שורת הכותרת 3. */
const D = {
  privateOne: 0, privateHalf: 1, requestAmount: 2, clientStatus: 3, feeFixed: 4, feePct: 5,
  signedAt: 6, clientName: 9, directCosts: 10, clientPayable: 11, notes1: 12, product: 13,
  stage: 14, feeAgreed: 15, expectedCollection: 16, collectionStatus: 17, month: 18, notes2: 19,
  collected: 20, lenders: 22, approvedBy: 23,
} as const

export function parseDeals(rows: Cell[][], opts: ParseOptions, warnings: ImportWarning[]) {
  const deals: ImportedDeal[] = []
  const transactions: ImportedTransaction[] = []

  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] ?? []
    const name = r[D.clientName]
    if (typeof name !== 'string' || !name.trim()) {
      // שורות סיכום/רעש בקובץ (למשל "247,142 ₪" בעמודת הוצאות ישירות) — לא תיק.
      if (toNumber(r[D.collected]) || toNumber(r[D.directCosts])) {
        warnings.push({ sourceRef: `wb:עסקאות:${i + 1}`, kind: 'deal_without_client', message: 'שורה עם סכומים בלי שם לקוח — דולגה' })
      }
      continue
    }
    const ref = `wb:עסקאות:${i + 1}`
    const feeAgreed = toNumber(r[D.feeAgreed]) ?? toNumber(r[D.feeFixed]) ?? 0
    const feePct = toNumber(r[D.feePct])
    const base = toNumber(r[D.requestAmount])
    const month = monthKey(opts.year, r[D.month])
    const clientStatus = typeof r[D.clientStatus] === 'string' ? (r[D.clientStatus] as string) : ''
    const collectionRaw = typeof r[D.collectionStatus] === 'string' ? (r[D.collectionStatus] as string) : ''

    const cancelled = /בוטל/.test(clientStatus) || /נדחה|לא אושר/.test(collectionRaw + clientStatus)
    const stage = mapBy(STAGE_MAP, r[D.stage], 'signed_collecting_docs')
    const status: ImportedDeal['status'] = cancelled ? 'cancelled' : stage === 'completed' ? 'won' : 'open'

    deals.push({
      sourceRef: ref,
      clientName: name.trim(),
      product: mapBy(PRODUCT_MAP, r[D.product], 'other'),
      stage,
      status,
      collectionStatus: mapBy(COLLECTION_MAP, r[D.collectionStatus], 'not_collected'),
      feeAgreedNet: feeAgreed,
      feeMode: feePct ? 'pct_of_credit' : 'fixed',
      feePct: feePct ?? undefined,
      baseAmount: base ?? undefined,
      monthAttributed: month,
      expectedCollectionDate: toIsoDate(r[D.expectedCollection], opts.year) ?? undefined,
      lenders: typeof r[D.lenders] === 'string' ? (r[D.lenders] as string).split(',').map((s) => s.trim()).filter(Boolean) : [],
      approvedBy: typeof r[D.approvedBy] === 'string' ? (r[D.approvedBy] as string) : undefined,
      notes: [r[D.notes1], r[D.notes2]].filter((x): x is string => typeof x === 'string' && x.trim() !== '').join(' · ') || undefined,
      privateOnePct: toNumber(r[D.privateOne]) || undefined,
      privateHalfPct: toNumber(r[D.privateHalf]) || undefined,
      clientPayableCosts: toNumber(r[D.clientPayable]) || undefined,
    })

    // נגבה בפועל (עמודה U) → תנועת הכנסה. SPEC נספח א: "נגזרת — Σ income actual".
    const collected = toNumber(r[D.collected])
    if (collected && collected > 0) {
      if (month) {
        transactions.push({
          sourceRef: `${ref}:income`, dateCash: lastDayOf(month), amountNet: collected, nature: 'income',
          dealSourceRef: ref, counterparty: name.trim(), description: 'שכ"ט — יובא מהקובץ', reviewStatus: 'ok', monthFromFile: month,
        })
      } else {
        warnings.push({ sourceRef: ref, kind: 'receipt_without_month', message: `תקבול ${collected} ₪ של "${name.trim()}" ללא חודש — הקובץ לא ספר אותו` })
        transactions.push({
          sourceRef: `${ref}:income`, dateCash: opts.importDate, amountNet: collected, nature: 'income',
          dealSourceRef: ref, counterparty: name.trim(),
          description: 'שכ"ט — יובא מהקובץ; חודש לא צוין בקובץ — לאמת תאריך', reviewStatus: 'ask_nissim',
        })
      }
    }

    // הוצאות ישירות (עמודה K) → expense עם deal_id. ערכי טקסט ('36 ש"ח') מנורמלים.
    const directRaw = r[D.directCosts]
    const direct = toNumber(directRaw)
    if (typeof directRaw === 'string' && direct !== null) {
      warnings.push({ sourceRef: ref, kind: 'text_in_numeric_cell', message: `הוצאה ישירה כטקסט "${directRaw}" → ${direct}` })
    }
    if (direct && direct > 0) {
      transactions.push({
        sourceRef: `${ref}:direct`, dateCash: month ? lastDayOf(month) : opts.importDate, amountNet: -direct, nature: 'expense',
        dealSourceRef: ref, categoryName: 'נסח טאבו', counterparty: name.trim(),
        description: month ? 'הוצאה ישירה — יובא מהקובץ' : 'הוצאה ישירה — יובא מהקובץ; לתיק אין חודש',
        deductible: true, reviewStatus: month ? 'ok' : 'ask_nissim', monthFromFile: month,
      })
    }
  }
  return { deals, transactions }
}

/** גיליון "הוצאות": תאריך | ספק | קטגוריה | סכום | מוכרת? | חודש | הערות */
export function parseExpenses(rows: Cell[][], opts: ParseOptions, warnings: ImportWarning[]): ImportedTransaction[] {
  const out: ImportedTransaction[] = []
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] ?? []
    const amount = toNumber(r[3])
    const supplier = typeof r[1] === 'string' ? (r[1] as string).trim() : ''
    if (!amount) continue
    const ref = `wb:הוצאות:${i + 1}`
    const month = monthKey(opts.year, r[5])
    let date = toIsoDate(r[0], opts.year)
    if (date && month && !date.startsWith(month)) {
      // הקובץ קובע את חודש ההתחשבנות לפי עמודת "חודש", לא לפי התאריך (למשל מתנה לחג 09/06 בחודש 9)
      warnings.push({ sourceRef: ref, kind: 'missing_date', message: `תאריך ${date} אינו בחודש ${month} — נלקח חודש הקובץ` })
      date = lastDayOf(month)
    }
    if (!date) {
      if (!month) { warnings.push({ sourceRef: ref, kind: 'missing_date', message: 'הוצאה בלי תאריך ובלי חודש — דולגה' }); continue }
      date = lastDayOf(month)
    }
    const deductible = r[4] === 'כן'
    out.push({
      sourceRef: ref, dateCash: date, amountNet: -Math.abs(amount), nature: 'expense',
      categoryName: typeof r[2] === 'string' && (r[2] as string).trim() ? (r[2] as string).trim() : 'שונות',
      counterparty: supplier || undefined,
      description: supplier ? undefined : 'הוצאה ללא ספק — יובא מהקובץ',
      deductible, reviewStatus: supplier ? 'ok' : 'unknown_expense', monthFromFile: month,
    })
  }
  return out
}

/** גיליון "מקדמות": תאריך | סכום | חודש | הערה */
export function parseAdvances(rows: Cell[][], opts: ParseOptions, warnings: ImportWarning[]): ImportedAdvance[] {
  const out: ImportedAdvance[] = []
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] ?? []
    const amount = toNumber(r[1])
    const month = monthKey(opts.year, r[2])
    if (!amount || !month) continue // שורת סיכום (86,550 בלי חודש)
    const ref = `wb:מקדמות:${i + 1}`
    const date = toIsoDate(r[0], opts.year)
    if (!date) warnings.push({ sourceRef: ref, kind: 'missing_date', message: 'מקדמה בלי תאריך — נלקח סוף החודש' })
    const note = typeof r[3] === 'string' ? (r[3] as string).trim() : ''
    const method: ImportedAdvance['method'] = /אשראי/.test(note) ? 'credit_card' : /מזומן/.test(note) ? 'cash' : 'transfer'
    out.push({ sourceRef: ref, date: date ?? lastDayOf(month), amountGross: amount, method, period: month, note: note || undefined })
  }
  return out
}

/** גיליון "כרטיס ניסים" — הערכים שהקובץ חישב, לאימות. */
export function parseNissimCard(rows: Cell[][], year: number): ImportBundle['fileNissimCard'] {
  const out: ImportBundle['fileNissimCard'] = []
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] ?? []
    const m = toNumber(r[1])
    if (!m || m < 1 || m > 12) continue
    out.push({
      month: `${year}-${String(m).padStart(2, '0')}`,
      income: toNumber(r[2]) ?? 0, deductible: toNumber(r[3]) ?? 0, direct: toNumber(r[4]) ?? 0,
      profit: toNumber(r[5]) ?? 0, advances: toNumber(r[8]) ?? 0, balance: toNumber(r[9]) ?? 0,
    })
  }
  return out
}

/**
 * מספר שהוקלד ידנית בכרטיס במקום נוסחה (ליקוי #1): הפער בין מה שהקובץ מציג
 * לבין Σ השורות. מיובא כהוצאה ישירה בלי תיק, מסומנת לבדיקה, כדי שהרווח
 * החודשי יתאים לקובץ אבל הפער יישאר גלוי.
 */
export function reconcileManualDirectCosts(bundle: ImportBundle, warnings: ImportWarning[]): ImportedTransaction[] {
  const out: ImportedTransaction[] = []
  for (const row of bundle.fileNissimCard) {
    const fromRows = bundle.transactions
      .filter((t) => t.nature === 'expense' && t.dealSourceRef && t.monthFromFile === row.month)
      .reduce((a, t) => a + Math.abs(t.amountNet), 0)
    const gap = Math.round((row.direct - fromRows) * 100) / 100
    if (gap > 0.005) {
      warnings.push({ sourceRef: `wb:כרטיס ניסים:${row.month}`, kind: 'manual_number_no_rows', message: `הוצאות ישירות ${row.month}: הקובץ מציג ${row.direct} אבל השורות מסתכמות ל-${fromRows} — הפער ${gap} הוקלד ידנית` })
      out.push({
        sourceRef: `wb:כרטיס ניסים:${row.month}:direct-gap`, dateCash: lastDayOf(row.month), amountNet: -gap, nature: 'expense',
        categoryName: 'שונות', description: `הוצאות ישירות ${row.month} — מספר שהוקלד ידנית בקובץ, ללא פירוט`,
        deductible: true, reviewStatus: 'ask_nissim', monthFromFile: row.month,
      })
    }
  }
  return out
}

export function parseWorkbook(sheets: WorkbookSheets, opts: ParseOptions): ImportBundle {
  const warnings: ImportWarning[] = []
  const { deals, transactions } = parseDeals(sheets.deals, opts, warnings)
  const expenses = parseExpenses(sheets.expenses, opts, warnings)
  const advances = parseAdvances(sheets.advances, opts, warnings)
  const bundle: ImportBundle = {
    year: opts.year,
    deals,
    transactions: [...transactions, ...expenses],
    advances,
    warnings,
    fileNissimCard: sheets.nissimCard ? parseNissimCard(sheets.nissimCard, opts.year) : [],
  }
  bundle.transactions.push(...reconcileManualDirectCosts(bundle, warnings))
  return bundle
}
