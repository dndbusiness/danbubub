/**
 * מייצר את tests/fixtures/nissim-card-2026.ts מהקובץ המוסווה דרך אותו parser
 * שמשמש לייבוא — כך שהפיקסצ'ר של קריטריון שלב 1 הוא הנתונים האמיתיים,
 * לא שחזור. מריצים מחדש כשהקובץ המוסווה מתעדכן.
 *
 *   node --experimental-strip-types scripts/fixture-from-workbook.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import xlsx from 'xlsx'
import { parseWorkbook } from '../lib/import/workbook.ts'

const SRC = 'tests/fixtures/workbook/harel-finance-2026.masked.xlsx'
const OUT = 'tests/fixtures/nissim-card-2026.ts'
const IMPORT_DATE = '2026-09-18'

const wb = xlsx.read(readFileSync(SRC), { cellDates: true })
const sheet = (n) => xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })
const b = parseWorkbook({ deals: sheet('עסקאות'), expenses: sheet('הוצאות'), advances: sheet('מקדמות'), nissimCard: sheet('כרטיס ניסים') }, { year: 2026, importDate: IMPORT_DATE })

const VAT = 0.18
const r2 = (n) => Math.round(n * 100) / 100
const js = (v) => JSON.stringify(v)
const dealId = (ref) => `deal:${ref.replace('wb:עסקאות:', '')}`

const fixedIds = {}
let fixedSeq = 0
const fixedFor = (cat) => (fixedIds[cat] ??= `fx-${++fixedSeq}`)

const lines = []
lines.push(`/**
 * פיקסצ'ר כרטיס ניסים — יולי/אוגוסט/ספטמבר 2026 — **מהקובץ האמיתי**.
 *
 * נוצר אוטומטית ע"י scripts/fixture-from-workbook.mjs מתוך
 * tests/fixtures/workbook/harel-finance-2026.masked.xlsx (הקובץ
 * "הר-אל-פתרונות-מימון-עסקי-דשבורד-ניסים-2026" כפי שיוצא מ-Google Sheets
 * ב-${IMPORT_DATE}, עם שמות מוסווים; סכומים וחודשים כפי שהם).
 * אין לערוך ידנית — להריץ מחדש את הסקריפט.
 *
 * SPEC §8: "3 חודשי כרטיס ניסים מהקובץ הקיים — התוצאות חייבות להשתוות לשקל".
 * מה שהקובץ עצמו מציג: יולי −28,262 · אוגוסט 105,882 · ספטמבר 22,447 · יתרה 36,516.5.
 *
 * שני דברים שהקובץ עושה ואנחנו מציפים:
 *   • שלושה תקבולים (17,460 ₪) ללא חודש — הקובץ לא סופר אותם (ליקוי #2).
 *     כאן הם מתוארכים ליום הייבוא ומסומנים ask_nissim.
 *   • הוצאות ישירות יולי 4,862 — מספר שהוקלד ידנית, בלי שורות (ליקוי #1).
 *     כאן הוא הוצאה בלי תיק, מסומנת ask_nissim; נכנס לשורה 2 ולא 3.
 */

import type { Advance, Deal, DivisionSplit, FixedExpense, Transaction } from '@/lib/rules/types.js'

/** מה הקובץ מציג (כרטיס ניסים, עמודה F). */
export const TARGETS = { '2026-07': -28_262, '2026-08': 105_882, '2026-09': 22_447 } as const
/** יתרת ניסים בסוף ספטמבר לפי הקובץ. */
export const TARGET_CLOSING_BALANCE = 36_516.5
/** הקובץ מתחיל מאפס (J4 = I4 − G4). */
export const OPENING_BALANCE = 0
/** תקבולים שהקובץ לא ספר כי אין להם חודש — מתוארכים ליום הייבוא. */
export const IMPORT_DATE = '${IMPORT_DATE}'
export const UNATTRIBUTED_INCOME = ${js(r2(b.transactions.filter((t) => t.nature === 'income' && t.reviewStatus === 'ask_nissim').reduce((a, t) => a + t.amountNet, 0)))}
export const DEFAULT_SPLIT: DivisionSplit = { finance: 0.8, realestate: 0.2 }
export const MONTHS = ['2026-07', '2026-08', '2026-09'] as const

const VAT = ${VAT}
const tx = (t: Omit<Transaction, 'accountId' | 'vatMode' | 'vatRate' | 'vatAmount' | 'amountGross' | 'txClass' | 'certainty' | 'invoiceStatus' | 'division'> & { division?: Transaction['division'] }): Transaction => ({
  accountId: 'acc-bank', vatMode: 'excl', vatRate: VAT,
  vatAmount: Math.round(t.amountNet * VAT * 100) / 100,
  amountGross: Math.round(t.amountNet * (1 + VAT) * 100) / 100,
  txClass: 'business', certainty: 'actual', invoiceStatus: 'unknown', division: 'finance', parentId: null,
  ...t,
})
`)

lines.push(`export const deals: Deal[] = [`)
for (const d of b.deals) {
  lines.push(`  { id: ${js(dealId(d.sourceRef))}, clientName: ${js(d.clientName)}, division: 'finance', product: ${js(d.product)}, stage: ${js(d.stage)} as Deal['stage'], collectionStatus: ${js(d.collectionStatus)} as Deal['collectionStatus'], feeAgreedNet: ${d.feeAgreedNet}, feeMode: 'fixed', status: ${js(d.status)}${d.monthAttributed ? `, monthAttributed: ${js(d.monthAttributed)}` : ''} },`)
}
lines.push(`]\n`)

lines.push(`/** הוצאות מהגיליון "הוצאות" — כל קטגוריה היא "הוצאה קבועה" מאושרת, כי בקובץ אין הבחנה. */
export const fixedExpenses: FixedExpense[] = [`)
const cats = [...new Set(b.transactions.filter((t) => t.nature === 'expense' && !t.dealSourceRef).map((t) => t.categoryName))]
for (const c of cats) {
  lines.push(`  { id: ${js(fixedFor(c))}, name: ${js(c)}, categoryId: ${js('cat:' + c)}, division: 'finance', amountNet: 0, vatMode: 'excl', frequency: 'monthly', dayOfMonth: 1, accountId: 'acc-bank', variable: true, approvedByNissim: true, startDate: '2026-01-01', active: true },`)
}
lines.push(`]\n`)

lines.push(`export const transactions: Transaction[] = [`)
let seq = 0
for (const t of b.transactions) {
  const id = `tx-${String(++seq).padStart(3, '0')}`
  const parts = [`id: ${js(id)}`, `dateCash: ${js(t.dateCash)}`, `amountNet: ${t.amountNet}`, `nature: ${js(t.nature)}`]
  if (t.dealSourceRef) parts.push(`dealId: ${js(dealId(t.dealSourceRef))}`)
  if (t.nature === 'expense') {
    parts.push(`categoryId: ${js('cat:' + (t.categoryName ?? 'שונות'))}`, `deductible: ${t.deductible ?? true}`)
    if (!t.dealSourceRef && !t.sourceRef.includes('direct-gap')) parts.push(`fixedExpenseId: ${js(fixedFor(t.categoryName))}`)
  }
  if (t.counterparty) parts.push(`counterparty: ${js(t.counterparty)}`)
  if (t.description) parts.push(`description: ${js(t.description)}`)
  if (t.reviewStatus && t.reviewStatus !== 'ok') parts.push(`reviewStatus: ${js(t.reviewStatus)}`)
  lines.push(`  tx({ ${parts.join(', ')} }), // ${t.sourceRef}`)
}
// מקדמות גם כתנועות advance (§1.3: לא נכנסות לרווח)
for (const a of b.advances) {
  const id = `tx-${String(++seq).padStart(3, '0')}`
  lines.push(`  tx({ id: ${js(id)}, dateCash: ${js(a.date)}, amountNet: ${-a.amountGross}, nature: 'advance', counterparty: 'ניסים', description: ${js(a.note ?? 'מקדמה')} }), // ${a.sourceRef}`)
}
lines.push(`]\n`)

lines.push(`export const advances: Advance[] = [`)
for (const a of b.advances) lines.push(`  { id: ${js(a.sourceRef)}, date: ${js(a.date)}, amountGross: ${a.amountGross}, method: ${js(a.method)}, period: ${js(a.period)}${a.note ? `, note: ${js(a.note)}` : ''} },`)
lines.push(`]\n`)

lines.push(`/** מה הקובץ חישב, לפי חודש — לאימות מול המערכת. */
export const FILE_CARD = ${JSON.stringify(Object.fromEntries(b.fileNissimCard.filter((m) => m.income || m.deductible || m.direct || m.advances).map((m) => [m.month, m])), null, 2)} as const
`)
writeFileSync(OUT, lines.join('\n'))
console.log(`✓ ${OUT}: ${b.deals.length} deals, ${b.transactions.length + b.advances.length} transactions, ${b.advances.length} advances`)
