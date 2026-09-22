import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_COLUMN_MAPS, findHeaderRow, parseCardStatement } from '@/lib/import/credit-card.js'
import { rowsFromBuffer } from '@/lib/import/rows.js'
import type { Cell } from '@/lib/import/workbook.js'

const rowsOf = (file: string): Cell[][] => rowsFromBuffer(readFileSync(file)).rows

describe('ייבוא כרטיס אשראי — SPEC §4.1', () => {
  const isracard = rowsOf('tests/fixtures/cards/isracard-sample.csv')
  const max = rowsOf('tests/fixtures/cards/max-sample.xlsx.csv')

  it('זיהוי פורמט לפי כותרות, גם כשיש כותרת-על מעל', () => {
    expect(findHeaderRow(isracard)?.map.id).toBe('isracard')
    expect(findHeaderRow(isracard)?.index).toBe(1)
    expect(findHeaderRow(max)?.map.id).toBe('max')
  })

  it('כל קובץ → תנועת-אב אחת + בנות; סכום הבנות = האב (SPEC §2.1)', () => {
    const r = parseCardStatement(isracard, { billingDate: '2026-09-10' })
    if ('error' in r) throw new Error(r.error)
    expect(r.children).toHaveLength(4)                    // 5 שורות − כפילות
    expect(r.parentAmount).toBe(-(89.9 + 250 + 120.5 - 199))
    expect(r.children.reduce((a, c) => a + c.amount, 0)).toBeCloseTo(r.parentAmount, 2)
    expect(r.billingDate).toBe('2026-09-10')
  })

  it('dedup לפי מס׳ עסקה + תאריך + סכום, עם אזהרה', () => {
    const r = parseCardStatement(isracard)
    if ('error' in r) throw new Error(r.error)
    expect(r.warnings.some((w) => w.includes('כפילות'))).toBe(true)
    expect(new Set(r.children.map((c) => c.sourceRef)).size).toBe(r.children.length)
  })

  it('זיכוי נשאר חיובי בתוך חיוב שלילי', () => {
    const r = parseCardStatement(isracard)
    if ('error' in r) throw new Error(r.error)
    expect(r.children.find((c) => c.merchant === 'ZARA')?.amount).toBe(199)
    expect(r.warnings.some((w) => w.includes('זיכויים'))).toBe(true)
  })

  it('שורת סה"כ ושורות ריקות מדולגות ונספרות', () => {
    const r = parseCardStatement(isracard)
    if ('error' in r) throw new Error(r.error)
    expect(r.skipped).toBeGreaterThanOrEqual(1)
  })

  it('מקס: תאריך dd.mm.yyyy, קטגוריה, 4 ספרות, מט"ח → סכום החיוב בש"ח', () => {
    const r = parseCardStatement(max)
    if ('error' in r) throw new Error(r.error)
    expect(r.children[0]!.date).toBe('2026-08-12')
    expect(r.children[0]!.amount).toBe(-199)
    expect(r.children[0]!.amountOriginal).toBe(49)
    expect(r.children[0]!.categoryHint).toBe('תוכנה')
    expect(r.children[0]!.cardLast4).toBe('5678')
  })

  it('קובץ לא מזוהה → שגיאה ברורה, לא ייבוא שגוי', () => {
    const r = parseCardStatement([['a', 'b'], [1, 2]])
    expect('error' in r).toBe(true)
  })

  it('מיפוי מותאם מההגדרות גובר על המובנה', () => {
    const custom = [{ ...DEFAULT_COLUMN_MAPS[0]!, id: 'bank-x', label: 'בנק X', detect: ['Date', 'Merchant', 'Amount'], date: ['Date'], merchant: ['Merchant'], amountCharged: ['Amount'] }]
    const r = parseCardStatement([['Date', 'Merchant', 'Amount'], ['2026-08-01', 'ACME', 10]], { maps: custom })
    if ('error' in r) throw new Error(r.error)
    expect(r.formatId).toBe('bank-x')
    expect(r.children[0]!.amount).toBe(-10)
  })
})
