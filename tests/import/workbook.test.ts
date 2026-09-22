import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import xlsx from 'xlsx'
import { parseWorkbook, toIsoDate, toNumber, type Cell } from '@/lib/import/workbook.js'

/**
 * הקובץ האמיתי (שמות מוסווים, סכומים וחודשים כפי שהם): "הר-אל-פתרונות-מימון-עסקי-דשבורד-ניסים-2026",
 * כפי שיוצא מ-Google Sheets ב-18/09/2026. SPEC §8: "3 חודשי כרטיס ניסים מהקובץ הקיים — התוצאות חייבות להשתוות לשקל".
 */
const wb = xlsx.read(readFileSync('tests/fixtures/workbook/harel-finance-2026.masked.xlsx'), { cellDates: true })
const sheet = (name: string) => xlsx.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, raw: true, defval: null }) as Cell[][]
const OPTS = { year: 2026, importDate: '2026-09-18' }
const bundle = parseWorkbook(
  { deals: sheet('עסקאות'), expenses: sheet('הוצאות'), advances: sheet('מקדמות'), nissimCard: sheet('כרטיס ניסים') },
  OPTS,
)

const byMonth = (pred: (t: (typeof bundle.transactions)[number]) => boolean) =>
  Object.fromEntries(['2026-07', '2026-08', '2026-09'].map((m) => [m, Math.round(
    bundle.transactions.filter((t) => pred(t) && t.dateCash.startsWith(m)).reduce((a, t) => a + Math.abs(t.amountNet), 0) * 100) / 100]))

describe('פרסור הקובץ הקיים', () => {
  it('28 תיקים (השורות עם שם לקוח), לא שורות הסיכום', () => {
    expect(bundle.deals).toHaveLength(28)
    expect(bundle.deals.every((d) => d.clientName)).toBe(true)
  })

  it('מיפוי שלבים, מוצרים וסטטוסי גביה לרשימות הסגורות', () => {
    const stages = new Set(bundle.deals.map((d) => d.stage))
    for (const s of stages) expect(['prospect', 'signed_collecting_docs', 'submitted', 'approved_in_principle', 'appraisal', 'lawyer_signing', 'execution', 'completed']).toContain(s)
    expect(bundle.deals.filter((d) => d.stage === 'completed')).toHaveLength(4)
    expect(bundle.deals.filter((d) => d.product === 'vehicle_lien')).toHaveLength(2)
    expect(bundle.deals.filter((d) => d.status === 'cancelled').length).toBeGreaterThanOrEqual(3)
  })

  it('תקבולים בפועל = Σ "נגבה בפועל" = 182,439 (כולל אלה שהקובץ לא ספר)', () => {
    const income = bundle.transactions.filter((t) => t.nature === 'income')
    expect(income.reduce((a, t) => a + t.amountNet, 0)).toBe(182_439)
  })

  it('שלושה תקבולים (17,460) ללא חודש — מסומנים לשאלה, לא נעלמים (ליקוי #2)', () => {
    const flagged = bundle.transactions.filter((t) => t.nature === 'income' && t.reviewStatus === 'ask_nissim')
    expect(flagged).toHaveLength(3)
    expect(flagged.reduce((a, t) => a + t.amountNet, 0)).toBe(17_460)
    expect(flagged.every((t) => t.dateCash === OPTS.importDate)).toBe(true)
    expect(bundle.warnings.filter((w) => w.kind === 'receipt_without_month')).toHaveLength(3)
  })

  it('מקדמות: 6 שורות, 86,550 ₪, לפי חודש 25,100 / 41,550 / 19,900', () => {
    expect(bundle.advances).toHaveLength(6)
    const byPeriod = (p: string) => bundle.advances.filter((a) => a.period === p).reduce((s, a) => s + a.amountGross, 0)
    expect(byPeriod('2026-07')).toBe(25_100)
    expect(byPeriod('2026-08')).toBe(41_550)
    expect(byPeriod('2026-09')).toBe(19_900)
    expect(bundle.advances.find((a) => a.note?.includes('מזומן'))?.method).toBe('cash')
  })

  it('הוצאות: "מוכרת?"=כן → deductible; הדס → לא', () => {
    const exp = bundle.transactions.filter((t) => t.nature === 'expense' && !t.dealSourceRef && !t.sourceRef.includes('direct-gap'))
    expect(exp).toHaveLength(14)
    expect(exp.filter((t) => t.deductible).length).toBe(8)
    expect(exp.find((t) => t.categoryName === 'שכר')?.deductible).toBe(false)
  })

  it('תאריך הוצאה "12.07.26" ותאריך Date נפרסים; בלי תאריך → סוף החודש', () => {
    expect(toIsoDate('12.07.26', 2026)).toBe('2026-07-12')
    expect(toIsoDate('10.7.26', 2026)).toBe('2026-07-10')
    expect(toIsoDate(new Date(Date.UTC(2026, 6, 31)), 2026)).toBe('2026-07-31')
    const noDate = bundle.transactions.find((t) => t.sourceRef === 'wb:הוצאות:7')!
    expect(noDate.dateCash).toBe('2026-08-31')
  })

  it('סכום כטקסט: "36 ש\\"ח" → 36, "247,142 ₪" → 247142', () => {
    expect(toNumber('36 ש"ח')).toBe(36)
    expect(toNumber('247,142 ₪')).toBe(247_142)
    expect(bundle.warnings.filter((w) => w.kind === 'text_in_numeric_cell')).toHaveLength(2)
  })

  it('הוצאות ישירות יולי 4,862 הוקלדו ידנית בקובץ — מיובאות כפער מסומן (ליקוי #1)', () => {
    const gap = bundle.transactions.find((t) => t.sourceRef.endsWith('2026-07:direct-gap'))!
    expect(gap.amountNet).toBe(-4_862)
    expect(gap.reviewStatus).toBe('ask_nissim')
    expect(bundle.warnings.some((w) => w.kind === 'manual_number_no_rows')).toBe(true)
  })

  it('כל source_ref ייחודי — הבסיס לייבוא idempotent (§11.9)', () => {
    const refs = [...bundle.deals, ...bundle.transactions, ...bundle.advances].map((x) => x.sourceRef)
    expect(new Set(refs).size).toBe(refs.length)
  })
})

describe('הקובץ מול עצמו: מה השורות מסתכמות ומה הכרטיס מציג', () => {
  const card = Object.fromEntries(bundle.fileNissimCard.map((m) => [m.month, m]))

  it('הכנסות לפי חודש (עם חודש בקובץ): אוגוסט 123,500 · ספטמבר 41,479', () => {
    const inc = byMonth((t) => t.nature === 'income' && t.reviewStatus === 'ok')
    expect(inc['2026-08']).toBe(card['2026-08']!.income)
    expect(inc['2026-09']).toBe(card['2026-09']!.income)
    expect(card['2026-07']!.income).toBe(0)
  })

  it('הוצאות מוכרות לפי חודש: 23,400 · 17,600 · 17,360', () => {
    const ded = byMonth((t) => t.nature === 'expense' && !t.dealSourceRef && t.deductible === true && !t.sourceRef.includes('direct-gap'))
    expect(ded).toEqual({ '2026-07': card['2026-07']!.deductible, '2026-08': card['2026-08']!.deductible, '2026-09': card['2026-09']!.deductible })
  })

  it('הוצאות ישירות לפי חודש: אוגוסט 18 · ספטמבר 1,672 מהשורות; יולי 4,862 רק מהפער הידני', () => {
    const direct = byMonth((t) => t.nature === 'expense' && Boolean(t.dealSourceRef) && t.reviewStatus === 'ok')
    expect(direct['2026-08']).toBe(18)
    expect(direct['2026-09']).toBe(1_672)
    expect(direct['2026-07']).toBe(0)
    expect(card['2026-07']!.direct).toBe(4_862)
  })

  it('הרווח לחלוקה שהקובץ מציג: −28,262 · 105,882 · 22,447; יתרה 36,516.5', () => {
    expect(card['2026-07']!.profit).toBe(-28_262)
    expect(card['2026-08']!.profit).toBe(105_882)
    expect(card['2026-09']!.profit).toBe(22_447)
    expect(card['2026-09']!.balance).toBe(36_516.5)
  })
})
