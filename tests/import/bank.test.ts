import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_BANK_MAPS, findBankHeaderRow, parseBankStatement } from '@/lib/import/bank.js'
import { rowsFromBuffer } from '@/lib/import/rows.js'
import type { Cell } from '@/lib/import/workbook.js'

const rows: Cell[][] = rowsFromBuffer(readFileSync('tests/fixtures/bank/hapoalim-sample.csv')).rows

describe('ייבוא דף בנק — SPEC §4.2', () => {
  it('זיהוי הבנק לפי כותרות, גם מתחת לכותרת-על', () => {
    const f = findBankHeaderRow(rows)
    expect(f?.map.id).toBe('hapoalim')
    expect(f?.index).toBe(1)
  })

  it('חובה → שלילי, זכות → חיובי; שורת "יתרת סגירה" מדולגת', () => {
    const r = parseBankStatement(rows)
    if ('error' in r) throw new Error(r.error)
    expect(r.rows).toHaveLength(5)
    expect(r.rows[0]).toMatchObject({ date: '2026-09-01', description: 'העברה מלקוח כהן', amount: 25_000, reference: '110045' })
    expect(r.rows[1]!.amount).toBe(-8_000)
    expect(r.skipped).toBeGreaterThanOrEqual(1)
  })

  it('תאריך ערך גובר על תאריך הפעולה (זה מה שנספר כ-date_cash)', () => {
    const r = parseBankStatement(rows)
    if ('error' in r) throw new Error(r.error)
    const card = r.rows.find((x) => x.description.includes('אשראי'))!
    expect(card.bookedDate).toBe('2026-09-05')
    expect(card.date).toBe('2026-09-06')
  })

  it('יתרת סגירה בדף = יתרה מחושבת (§4.2)', () => {
    const r = parseBankStatement(rows)
    if ('error' in r) throw new Error(r.error)
    expect(r.openingBalance).toBe(150_000)
    expect(r.closingBalance).toBe(160_000)
    expect(r.computedClosing).toBe(160_000)
    expect(r.balanceMatches).toBe(true)
    expect(r.balanceGap).toBe(0)
  })

  it('יתרה שלא מסתדרת — הפער מדווח ולא נבלע', () => {
    const broken = rows.map((r) => [...r])
    broken[3]![6] = '166000.00'     // יתרה שגויה בשורת השכירות
    const r = parseBankStatement(broken)
    if ('error' in r) throw new Error(r.error)
    expect(r.balanceMatches).toBe(false)
    expect(r.firstBalanceBreak?.description).toBe('שכירות משרד')
    expect(r.warnings.some((w) => w.includes('היתרה נשברת'))).toBe(true)
  })

  it('פורמט לא מוכר → שגיאה מפורשת, לא ניחוש', () => {
    const r = parseBankStatement([['a', 'b'], ['1', '2']])
    expect('error' in r && r.error).toContain('לא זוהה פורמט')
  })

  it('מיפוי גנרי: עמודת סכום אחת חתומה', () => {
    const generic: Cell[][] = [['תאריך', 'תיאור', 'סכום', 'יתרה'], ['01/09/2026', 'תקבול', '1000', '101000'], ['02/09/2026', 'הוצאה', '-250', '100750']]
    const r = parseBankStatement(generic, { maps: DEFAULT_BANK_MAPS.filter((m) => m.id === 'generic') })
    if ('error' in r) throw new Error(r.error)
    expect(r.rows.map((x) => x.amount)).toEqual([1000, -250])
    expect(r.balanceMatches).toBe(true)
  })
})
