import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isPartnerSupplier, parseGreenInvoiceExport } from '@/lib/import/greeninvoice.js'
import { rowsFromBuffer } from '@/lib/import/rows.js'

const rows = rowsFromBuffer(readFileSync('tests/fixtures/greeninvoice/expenses-sample.csv')).rows

describe('ייבוא חשבונית ירוקה — SPEC §4.3', () => {
  const r = parseGreenInvoiceExport(rows)
  if ('error' in r) throw new Error(r.error)

  it('14 העמודות נקראות; שורה ריקה מדולגת', () => {
    expect(r.rows.length).toBe(5)
    expect(r.skipped).toBe(0)
    expect(r.rows[0]).toMatchObject({ docNumber: '1001', docDate: '2026-09-03', docType: 'invoice', gross: 1180, vat: 180, net: 1000 })
  })

  it('"חודש דיווח" הוא חודש המע"מ, וייתכן שונה מחודש המסמך', () => {
    const usd = r.rows.find((x) => x.currency === 'USD')!
    expect(usd.docDate).toBe('2026-09-07')
    expect(usd.vatPeriod).toBe('2026-10')
    expect(r.rows[0]!.vatPeriod).toBe('2026-09')
  })

  it('מט"ח: תמיד "סכום הוצאה עסקית" בש"ח, לא הסכום המקורי', () => {
    const usd = r.rows.find((x) => x.currency === 'USD')!
    expect(usd.gross).toBe(182)
    expect(usd.originalGross).toBe(49)
  })

  it('חשבונית זיכוי = סכום שלילי', () => {
    const credit = r.rows.find((x) => x.docType === 'credit_note')!
    expect(credit.gross).toBe(-236)
    expect(credit.vat).toBe(-36)
  })

  it('"הוצאה פתוחה" → reported=false', () => {
    expect(r.totals.open).toBe(2)
    expect(r.totals.reported).toBe(3)
  })

  it('כפילות לפי (מסמך, ספק מנורמל, סכום) — מסומנת ולא מיובאת פעמיים', () => {
    expect(r.duplicates).toHaveLength(1)
    expect(r.duplicates[0]!.docNumber).toBe('1001')
    expect(r.warnings.some((w) => w.includes('כפילויות'))).toBe(true)
    // "בע\"מ" מול "בעמ" — אותו ספק
    expect(r.rows.filter((x) => x.docNumber === '1001')).toHaveLength(1)
  })

  it('ספק שהוא ישות של שותף — אינו הוצאה, דורש אישור', () => {
    expect(isPartnerSupplier('די.אנד.די. עסקים')).toBe(true)
    expect(isPartnerSupplier('ספק לדוגמה בע"מ')).toBe(false)
    expect(r.warnings.some((w) => w.includes('ישות של שותף'))).toBe(true)
  })

  it('קובץ שאינו ייצוא של חשבונית ירוקה → שגיאה מפורשת', () => {
    const bad = parseGreenInvoiceExport([['a', 'b'], ['1', '2']])
    expect('error' in bad && bad.error).toContain('לא זוהה ייצוא')
  })
})
