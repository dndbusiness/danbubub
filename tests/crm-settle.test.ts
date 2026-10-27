import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** נקודת האיזון בהתחשבנות עם ניסים — אותו קוד שרץ במסך (crm/harel-crm.html), בלי DOM */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ נקודת איזון בהתחשבנות עם ניסים'), b = html.indexOf('/* ══ סוף נקודת איזון ══ */')
type Row = { income: number; fixed: number; direct: number; adv: number; closing: number; reserve?: number; released?: number }
const settleBreakEven = new Function(html.slice(a, b) + '; return settleBreakEven;')() as (r: Row, p: number, poolBefore?: number) => {
  business: number; businessGap: number; nissim: number; nissimGap: number; owes: number; owed: number; clearAll: number }

describe('נקודת איזון — התחשבנות עם ניסים (דן 27/10)', () => {
  it('הבלוק קיים בדף', () => { expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a) })
  it('נכנס 60K, קבועות 20K, ישירות 5K, מקדמות 20K, ניסים 50%: איזון לעסק 25K; לניסים 25K + 20K/50% = 65K — חסרים 5K', () => {
    const r = settleBreakEven({ income: 60000, fixed: 20000, direct: 5000, adv: 20000, closing: 2500 }, 0.5)
    expect(r.business).toBe(25000); expect(r.businessGap).toBe(35000)
    expect(r.nissim).toBe(65000); expect(r.nissimGap).toBe(-5000)
    // בדיקה: רווח 35K × 50% = 17.5K חלקו, מקדמות 20K → החוב גדל ב-2.5K — בדיוק החוסר 5K × 50%
    expect(r.owes).toBe(2500); expect(r.owed).toBe(0); expect(r.clearAll).toBe(5000)
  })
  it('יתרה שלילית = החברה חייבת לניסים', () => {
    const r = settleBreakEven({ income: 100000, fixed: 20000, direct: 0, adv: 10000, closing: -30000 }, 0.5)
    expect(r.owes).toBe(0); expect(r.owed).toBe(30000); expect(r.clearAll).toBe(0)
  })
  it('שריון, שחרור והחזר לדן קודם (dan_first) נכנסים לנקודת האיזון של ניסים', () => {
    const r = settleBreakEven({ income: 0, fixed: 10000, direct: 0, adv: 5000, closing: 0, reserve: 3000, released: 1000 }, 0.5, 4000)
    expect(r.nissim).toBe(10000 - 1000 + 3000 + 4000 + 10000)
  })
  it('בלי אחוז תקין — 50%', () => { expect(settleBreakEven({ income: 0, fixed: 0, direct: 0, adv: 1000, closing: 0 }, 0).nissim).toBe(2000) })
})
