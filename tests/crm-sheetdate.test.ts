import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** תאריך מטבלת הלידים של המשווק — אותו קוד שרץ במסך (crm/harel-crm.html). דן 28/10: "למה לא מסתנכרן". */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('function parseSheetDate('), b = html.indexOf('/* מקורות: אבינועם')
const parse = new Function('today', html.slice(a, b) + '; return parseSheetDate;')(() => '2026-10-28') as (cell: { w?: string; v?: unknown }, us?: boolean) => string | null
const at = (w: string, us?: boolean) => parse({ w }, us)

describe('תאריך בטבלת אבינועם — חודש/יום', () => {
  it('09/10/26 = 10 בספטמבר, לא 9 באוקטובר (הבאג)', () => {
    expect(at('09/10/26 13:13', true)).toBe('2026-09-10T13:13:00')
    expect(at('09/10/26 13:13')).toBe('2026-10-09T13:13:00') // ההתנהגות הישנה, נשארת לטפסים
  })
  it('תאריך שלא קיים כחודש/יום או בעתיד → יום/חודש', () => {
    expect(at('10/25/26 08:00', true)).toBe('2026-10-25T08:00:00')
    expect(at('25/10/26 08:00', true)).toBe('2026-10-25T08:00:00')
    expect(at('11/10/26 09:00', true)).toBe('2026-10-11T09:00:00') // 10 בנובמבר עוד לא הגיע
  })
  it('ISO ושעה עם AM/PM', () => {
    expect(at('2026-09-01 22:37', true)).toBe('2026-09-01T22:37:00')
    expect(at('9/1/2026 10:37 PM', true)).toBe('2026-09-01T22:37:00')
  })
  it('ריק / לא תאריך → null', () => { expect(at('', true)).toBeNull(); expect(at('שם', true)).toBeNull() })
})
