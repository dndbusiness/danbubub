/**
 * פיקסצ'ר כרטיס ניסים — יולי/אוגוסט/ספטמבר 2026 — **מהקובץ האמיתי**.
 *
 * נוצר אוטומטית ע"י scripts/fixture-from-workbook.mjs מתוך
 * tests/fixtures/workbook/harel-finance-2026.masked.xlsx (הקובץ
 * "הר-אל-פתרונות-מימון-עסקי-דשבורד-ניסים-2026" כפי שיוצא מ-Google Sheets
 * ב-2026-09-18, עם שמות מוסווים; סכומים וחודשים כפי שהם).
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
export const IMPORT_DATE = '2026-09-18'
export const UNATTRIBUTED_INCOME = 17460
export const DEFAULT_SPLIT: DivisionSplit = { finance: 0.8, realestate: 0.2 }
export const MONTHS = ['2026-07', '2026-08', '2026-09'] as const

const VAT = 0.18
const tx = (t: Omit<Transaction, 'accountId' | 'vatMode' | 'vatRate' | 'vatAmount' | 'amountGross' | 'txClass' | 'certainty' | 'invoiceStatus' | 'division'> & { division?: Transaction['division'] }): Transaction => ({
  accountId: 'acc-bank', vatMode: 'excl', vatRate: VAT,
  vatAmount: Math.round(t.amountNet * VAT * 100) / 100,
  amountGross: Math.round(t.amountNet * (1 + VAT) * 100) / 100,
  txClass: 'business', certainty: 'actual', invoiceStatus: 'unknown', division: 'finance', parentId: null,
  ...t,
})

export const deals: Deal[] = [
  { id: "deal:4", clientName: "לקוח 01", division: 'finance', product: "mortgage_declined", stage: "execution" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 28342, feeMode: 'fixed', status: "open", monthAttributed: "2026-09" },
  { id: "deal:5", clientName: "לקוח 02", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 145000, feeMode: 'fixed', status: "open" },
  { id: "deal:6", clientName: "לקוח 03", division: 'finance', product: "mortgage_declined", stage: "prospect" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 20000, feeMode: 'fixed', status: "open" },
  { id: "deal:7", clientName: "לקוח 04", division: 'finance', product: "mortgage_declined", stage: "appraisal" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 10000, feeMode: 'fixed', status: "open", monthAttributed: "2026-09" },
  { id: "deal:8", clientName: "לקוח 05", division: 'finance', product: "mortgage_declined", stage: "execution" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 30000, feeMode: 'fixed', status: "open", monthAttributed: "2026-09" },
  { id: "deal:9", clientName: "לקוח 06", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "cancelled" as Deal['collectionStatus'], feeAgreedNet: 0, feeMode: 'fixed', status: "cancelled" },
  { id: "deal:10", clientName: "לקוח 07", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 0, feeMode: 'fixed', status: "cancelled" },
  { id: "deal:11", clientName: "לקוח 08", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 0, feeMode: 'fixed', status: "open" },
  { id: "deal:12", clientName: "לקוח 09", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 0, feeMode: 'fixed', status: "open" },
  { id: "deal:13", clientName: "לקוח 10", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 0, feeMode: 'fixed', status: "cancelled" },
  { id: "deal:14", clientName: "לקוח 11", division: 'finance', product: "mortgage_declined", stage: "execution" as Deal['stage'], collectionStatus: "partially_paid" as Deal['collectionStatus'], feeAgreedNet: 77000, feeMode: 'fixed', status: "open", monthAttributed: "2026-09" },
  { id: "deal:15", clientName: "לקוח 12", division: 'finance', product: "mortgage_declined", stage: "completed" as Deal['stage'], collectionStatus: "fully_paid" as Deal['collectionStatus'], feeAgreedNet: 96100, feeMode: 'fixed', status: "won", monthAttributed: "2026-08" },
  { id: "deal:16", clientName: "לקוח 13", division: 'finance', product: "mortgage_declined", stage: "completed" as Deal['stage'], collectionStatus: "fully_paid" as Deal['collectionStatus'], feeAgreedNet: 25000, feeMode: 'fixed', status: "won", monthAttributed: "2026-08" },
  { id: "deal:17", clientName: "לקוח 14", division: 'finance', product: "business_credit", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "partially_paid" as Deal['collectionStatus'], feeAgreedNet: 24750, feeMode: 'fixed', status: "open" },
  { id: "deal:18", clientName: "לקוח 15", division: 'finance', product: "mortgage_declined", stage: "completed" as Deal['stage'], collectionStatus: "fully_paid" as Deal['collectionStatus'], feeAgreedNet: 34700, feeMode: 'fixed', status: "won", monthAttributed: "2026-09" },
  { id: "deal:19", clientName: "לקוח 16", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 64000, feeMode: 'fixed', status: "open" },
  { id: "deal:20", clientName: "לקוח 17", division: 'finance', product: "mortgage_declined", stage: "approved_in_principle" as Deal['stage'], collectionStatus: "partially_paid" as Deal['collectionStatus'], feeAgreedNet: 4800, feeMode: 'fixed', status: "open", monthAttributed: "2026-08" },
  { id: "deal:21", clientName: "לקוח 18", division: 'finance', product: "business_credit", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 32500, feeMode: 'fixed', status: "open" },
  { id: "deal:22", clientName: "לקוח 19", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 58000, feeMode: 'fixed', status: "open" },
  { id: "deal:23", clientName: "לקוח 20", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 77500, feeMode: 'fixed', status: "open" },
  { id: "deal:24", clientName: "לקוח 21", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 60000, feeMode: 'fixed', status: "open" },
  { id: "deal:25", clientName: "לקוח 22", division: 'finance', product: "business_credit", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "partially_paid" as Deal['collectionStatus'], feeAgreedNet: 10000, feeMode: 'fixed', status: "open", monthAttributed: "2026-09" },
  { id: "deal:26", clientName: "לקוח 23", division: 'finance', product: "vehicle_lien", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "fully_paid" as Deal['collectionStatus'], feeAgreedNet: 5000, feeMode: 'fixed', status: "open" },
  { id: "deal:27", clientName: "לקוח 24", division: 'finance', product: "mortgage_declined", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 20000, feeMode: 'fixed', status: "open" },
  { id: "deal:28", clientName: "לקוח 25", division: 'finance', product: "business_credit", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 12000, feeMode: 'fixed', status: "open" },
  { id: "deal:29", clientName: "לקוח 26", division: 'finance', product: "vehicle_lien", stage: "completed" as Deal['stage'], collectionStatus: "fully_paid" as Deal['collectionStatus'], feeAgreedNet: 8000, feeMode: 'fixed', status: "won" },
  { id: "deal:30", clientName: "לקוח 27", division: 'finance', product: "other", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 50000, feeMode: 'fixed', status: "open" },
  { id: "deal:31", clientName: "לקוח 28", division: 'finance', product: "other", stage: "signed_collecting_docs" as Deal['stage'], collectionStatus: "not_collected" as Deal['collectionStatus'], feeAgreedNet: 17000, feeMode: 'fixed', status: "open" },
]

/** הוצאות מהגיליון "הוצאות" — כל קטגוריה היא "הוצאה קבועה" מאושרת, כי בקובץ אין הבחנה. */
export const fixedExpenses: FixedExpense[] = [
  { id: "fx-1", name: "שיווק", categoryId: "cat:שיווק", division: 'finance', amountNet: 0, vatMode: 'excl', frequency: 'monthly', dayOfMonth: 1, accountId: 'acc-bank', variable: true, approvedByNissim: true, startDate: '2026-01-01', active: true },
  { id: "fx-2", name: "משרד", categoryId: "cat:משרד", division: 'finance', amountNet: 0, vatMode: 'excl', frequency: 'monthly', dayOfMonth: 1, accountId: 'acc-bank', variable: true, approvedByNissim: true, startDate: '2026-01-01', active: true },
  { id: "fx-3", name: "תוכנה ומערכות", categoryId: "cat:תוכנה ומערכות", division: 'finance', amountNet: 0, vatMode: 'excl', frequency: 'monthly', dayOfMonth: 1, accountId: 'acc-bank', variable: true, approvedByNissim: true, startDate: '2026-01-01', active: true },
  { id: "fx-4", name: "שכר", categoryId: "cat:שכר", division: 'finance', amountNet: 0, vatMode: 'excl', frequency: 'monthly', dayOfMonth: 1, accountId: 'acc-bank', variable: true, approvedByNissim: true, startDate: '2026-01-01', active: true },
  { id: "fx-5", name: "שונות", categoryId: "cat:שונות", division: 'finance', amountNet: 0, vatMode: 'excl', frequency: 'monthly', dayOfMonth: 1, accountId: 'acc-bank', variable: true, approvedByNissim: true, startDate: '2026-01-01', active: true },
]

export const transactions: Transaction[] = [
  tx({ id: "tx-001", dateCash: "2026-09-30", amountNet: -1618, nature: "expense", dealId: "deal:4", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 01", description: "הוצאה ישירה — יובא מהקובץ" }), // wb:עסקאות:4:direct
  tx({ id: "tx-002", dateCash: "2026-09-18", amountNet: -1618, nature: "expense", dealId: "deal:5", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 02", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:5:direct
  tx({ id: "tx-003", dateCash: "2026-09-18", amountNet: -18, nature: "expense", dealId: "deal:6", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 03", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:6:direct
  tx({ id: "tx-004", dateCash: "2026-09-30", amountNet: -18, nature: "expense", dealId: "deal:7", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 04", description: "הוצאה ישירה — יובא מהקובץ" }), // wb:עסקאות:7:direct
  tx({ id: "tx-005", dateCash: "2026-09-30", amountNet: -18, nature: "expense", dealId: "deal:8", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 05", description: "הוצאה ישירה — יובא מהקובץ" }), // wb:עסקאות:8:direct
  tx({ id: "tx-006", dateCash: "2026-09-18", amountNet: -18, nature: "expense", dealId: "deal:9", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 06", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:9:direct
  tx({ id: "tx-007", dateCash: "2026-09-18", amountNet: -18, nature: "expense", dealId: "deal:11", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 08", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:11:direct
  tx({ id: "tx-008", dateCash: "2026-09-18", amountNet: -18, nature: "expense", dealId: "deal:12", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 09", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:12:direct
  tx({ id: "tx-009", dateCash: "2026-09-18", amountNet: -18, nature: "expense", dealId: "deal:13", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 10", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:13:direct
  tx({ id: "tx-010", dateCash: "2026-09-30", amountNet: 6779, nature: "income", dealId: "deal:14", counterparty: "לקוח 11", description: "שכ\"ט — יובא מהקובץ" }), // wb:עסקאות:14:income
  tx({ id: "tx-011", dateCash: "2026-08-31", amountNet: 96100, nature: "income", dealId: "deal:15", counterparty: "לקוח 12", description: "שכ\"ט — יובא מהקובץ" }), // wb:עסקאות:15:income
  tx({ id: "tx-012", dateCash: "2026-08-31", amountNet: 25000, nature: "income", dealId: "deal:16", counterparty: "לקוח 13", description: "שכ\"ט — יובא מהקובץ" }), // wb:עסקאות:16:income
  tx({ id: "tx-013", dateCash: "2026-08-31", amountNet: -18, nature: "expense", dealId: "deal:16", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 13", description: "הוצאה ישירה — יובא מהקובץ" }), // wb:עסקאות:16:direct
  tx({ id: "tx-014", dateCash: "2026-09-18", amountNet: 2300, nature: "income", dealId: "deal:17", counterparty: "לקוח 14", description: "שכ\"ט — יובא מהקובץ; חודש לא צוין בקובץ — לאמת תאריך", reviewStatus: "ask_nissim" }), // wb:עסקאות:17:income
  tx({ id: "tx-015", dateCash: "2026-09-18", amountNet: -18, nature: "expense", dealId: "deal:17", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 14", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:17:direct
  tx({ id: "tx-016", dateCash: "2026-09-30", amountNet: 34700, nature: "income", dealId: "deal:18", counterparty: "לקוח 15", description: "שכ\"ט — יובא מהקובץ" }), // wb:עסקאות:18:income
  tx({ id: "tx-017", dateCash: "2026-09-30", amountNet: -18, nature: "expense", dealId: "deal:18", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 15", description: "הוצאה ישירה — יובא מהקובץ" }), // wb:עסקאות:18:direct
  tx({ id: "tx-018", dateCash: "2026-08-31", amountNet: 2400, nature: "income", dealId: "deal:20", counterparty: "לקוח 17", description: "שכ\"ט — יובא מהקובץ" }), // wb:עסקאות:20:income
  tx({ id: "tx-019", dateCash: "2026-09-18", amountNet: -36, nature: "expense", dealId: "deal:22", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 19", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:22:direct
  tx({ id: "tx-020", dateCash: "2026-09-18", amountNet: 10160, nature: "income", dealId: "deal:23", counterparty: "לקוח 20", description: "שכ\"ט — יובא מהקובץ; חודש לא צוין בקובץ — לאמת תאריך", reviewStatus: "ask_nissim" }), // wb:עסקאות:23:income
  tx({ id: "tx-021", dateCash: "2026-09-18", amountNet: -67, nature: "expense", dealId: "deal:23", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 20", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:23:direct
  tx({ id: "tx-022", dateCash: "2026-09-18", amountNet: 5000, nature: "income", dealId: "deal:26", counterparty: "לקוח 23", description: "שכ\"ט — יובא מהקובץ; חודש לא צוין בקובץ — לאמת תאריך", reviewStatus: "ask_nissim" }), // wb:עסקאות:26:income
  tx({ id: "tx-023", dateCash: "2026-09-18", amountNet: -1500, nature: "expense", dealId: "deal:26", categoryId: "cat:נסח טאבו", deductible: true, counterparty: "לקוח 23", description: "הוצאה ישירה — יובא מהקובץ; לתיק אין חודש", reviewStatus: "ask_nissim" }), // wb:עסקאות:26:direct
  tx({ id: "tx-024", dateCash: "2026-07-12", amountNet: -11700, nature: "expense", categoryId: "cat:שיווק", deductible: true, fixedExpenseId: "fx-1", counterparty: "ספק 01" }), // wb:הוצאות:4
  tx({ id: "tx-025", dateCash: "2026-07-20", amountNet: -11700, nature: "expense", categoryId: "cat:שיווק", deductible: true, fixedExpenseId: "fx-1", counterparty: "ספק 01" }), // wb:הוצאות:5
  tx({ id: "tx-026", dateCash: "2026-07-31", amountNet: -9450, nature: "expense", categoryId: "cat:משרד", deductible: false, fixedExpenseId: "fx-2", counterparty: "ספק 02" }), // wb:הוצאות:6
  tx({ id: "tx-027", dateCash: "2026-08-31", amountNet: -11700, nature: "expense", categoryId: "cat:שיווק", deductible: true, fixedExpenseId: "fx-1", counterparty: "ספק 01" }), // wb:הוצאות:7
  tx({ id: "tx-028", dateCash: "2026-08-31", amountNet: -7000, nature: "expense", categoryId: "cat:שיווק", deductible: false, fixedExpenseId: "fx-1", counterparty: "ספק 03" }), // wb:הוצאות:8
  tx({ id: "tx-029", dateCash: "2026-08-31", amountNet: -1000, nature: "expense", categoryId: "cat:תוכנה ומערכות", deductible: false, fixedExpenseId: "fx-3", counterparty: "ספק 04" }), // wb:הוצאות:9
  tx({ id: "tx-030", dateCash: "2026-08-31", amountNet: -5900, nature: "expense", categoryId: "cat:שיווק", deductible: true, fixedExpenseId: "fx-1", counterparty: "ספק 05" }), // wb:הוצאות:10
  tx({ id: "tx-031", dateCash: "2026-08-31", amountNet: -13500, nature: "expense", categoryId: "cat:שכר", deductible: false, fixedExpenseId: "fx-4", counterparty: "ספק 02" }), // wb:הוצאות:12
  tx({ id: "tx-032", dateCash: "2026-09-30", amountNet: -2750, nature: "expense", categoryId: "cat:שיווק", deductible: true, fixedExpenseId: "fx-1", counterparty: "ספק 06" }), // wb:הוצאות:13
  tx({ id: "tx-033", dateCash: "2026-08-31", amountNet: -2000, nature: "expense", categoryId: "cat:שיווק", deductible: false, fixedExpenseId: "fx-1", counterparty: "ספק 07" }), // wb:הוצאות:14
  tx({ id: "tx-034", dateCash: "2026-09-30", amountNet: -1350, nature: "expense", categoryId: "cat:שונות", deductible: true, fixedExpenseId: "fx-5", counterparty: "ספק 08" }), // wb:הוצאות:15
  tx({ id: "tx-035", dateCash: "2026-09-30", amountNet: -5310, nature: "expense", categoryId: "cat:שונות", deductible: true, fixedExpenseId: "fx-5", counterparty: "ספק 09" }), // wb:הוצאות:16
  tx({ id: "tx-036", dateCash: "2026-09-30", amountNet: -800, nature: "expense", categoryId: "cat:תוכנה ומערכות", deductible: false, fixedExpenseId: "fx-3", counterparty: "ספק 10" }), // wb:הוצאות:17
  tx({ id: "tx-037", dateCash: "2026-09-30", amountNet: -7950, nature: "expense", categoryId: "cat:שיווק", deductible: true, fixedExpenseId: "fx-1", counterparty: "ספק 11" }), // wb:הוצאות:18
  tx({ id: "tx-038", dateCash: "2026-07-31", amountNet: -4862, nature: "expense", categoryId: "cat:שונות", deductible: true, description: "הוצאות ישירות 2026-07 — מספר שהוקלד ידנית בקובץ, ללא פירוט", reviewStatus: "ask_nissim" }), // wb:כרטיס ניסים:2026-07:direct-gap
  tx({ id: "tx-039", dateCash: "2026-07-10", amountNet: -13700, nature: 'advance', counterparty: 'ניסים', description: "אשראי" }), // wb:מקדמות:4
  tx({ id: "tx-040", dateCash: "2026-07-10", amountNet: -11400, nature: 'advance', counterparty: 'ניסים', description: "מזומן" }), // wb:מקדמות:5
  tx({ id: "tx-041", dateCash: "2026-08-10", amountNet: -19550, nature: 'advance', counterparty: 'ניסים', description: "אשראי" }), // wb:מקדמות:6
  tx({ id: "tx-042", dateCash: "2026-08-01", amountNet: -10000, nature: 'advance', counterparty: 'ניסים', description: "הערה" }), // wb:מקדמות:7
  tx({ id: "tx-043", dateCash: "2026-09-10", amountNet: -19900, nature: 'advance', counterparty: 'ניסים', description: "הערה" }), // wb:מקדמות:8
  tx({ id: "tx-044", dateCash: "2026-08-28", amountNet: -12000, nature: 'advance', counterparty: 'ניסים', description: "הערה" }), // wb:מקדמות:9
]

export const advances: Advance[] = [
  { id: "wb:מקדמות:4", date: "2026-07-10", amountGross: 13700, method: "credit_card", period: "2026-07", note: "אשראי" },
  { id: "wb:מקדמות:5", date: "2026-07-10", amountGross: 11400, method: "cash", period: "2026-07", note: "מזומן" },
  { id: "wb:מקדמות:6", date: "2026-08-10", amountGross: 19550, method: "credit_card", period: "2026-08", note: "אשראי" },
  { id: "wb:מקדמות:7", date: "2026-08-01", amountGross: 10000, method: "transfer", period: "2026-08", note: "הערה" },
  { id: "wb:מקדמות:8", date: "2026-09-10", amountGross: 19900, method: "transfer", period: "2026-09", note: "הערה" },
  { id: "wb:מקדמות:9", date: "2026-08-28", amountGross: 12000, method: "transfer", period: "2026-08", note: "הערה" },
]

/** מה הקובץ חישב, לפי חודש — לאימות מול המערכת. */
export const FILE_CARD = {
  "2026-07": {
    "month": "2026-07",
    "income": 0,
    "deductible": 23400,
    "direct": 4862,
    "profit": -28262,
    "advances": 25100,
    "balance": 39231
  },
  "2026-08": {
    "month": "2026-08",
    "income": 123500,
    "deductible": 17600,
    "direct": 18,
    "profit": 105882,
    "advances": 41550,
    "balance": 27840
  },
  "2026-09": {
    "month": "2026-09",
    "income": 41479,
    "deductible": 17360,
    "direct": 1672,
    "profit": 22447,
    "advances": 19900,
    "balance": 36516.5
  }
} as const
