import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** ימי תשלום: אשראי, ספקים (דן 22/11) — אותו קוד שרץ במסך */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ ימי תשלום — פונקציות טהורות'), b = html.indexOf('/* ══ סוף ימי תשלום ══ */')
const F = new Function(html.slice(a, b) + '; return { dayIn, cardChargeOf, nextCardDay, supplierDue };')() as any

describe('ימי תשלום', () => {
  it('יום בחודש — 30 בפברואר = הסוף של פברואר', () => { expect(F.dayIn('2027-02-10', 30)).toBe('2027-02-28'); expect(F.dayIn('2026-11-03', 15)).toBe('2026-11-15') })
  it('הוצאה באשראי ב-3 לחודש → יורדת ב-15 של אותו חודש', () => expect(F.cardChargeOf('2026-11-03', 15)).toBe('2026-11-15'))
  it('החיוב הבא באשראי: לפני ה-15 — החודש; אחרי — בחודש הבא; דצמבר → ינואר', () => {
    expect(F.nextCardDay('2026-11-10', 15)).toBe('2026-11-15'); expect(F.nextCardDay('2026-11-15', 15)).toBe('2026-11-15')
    expect(F.nextCardDay('2026-11-22', 15)).toBe('2026-12-15'); expect(F.nextCardDay('2026-12-20', 15)).toBe('2027-01-15')
  })
  it('ספק ב-10: חשבון נובמבר משולם ב-10/12; חשבון שעבר — לא לפני היום', () => {
    expect(F.supplierDue('2026-11', 10, '2026-11-22')).toBe('2026-12-10'); expect(F.supplierDue('2026-10', 10, '2026-11-22')).toBe('2026-11-22')
    expect(F.supplierDue('2026-12', 30, '2026-11-22')).toBe('2027-01-30')
  })
})
