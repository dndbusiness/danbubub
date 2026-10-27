import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** נקודת ה-0 בהתחשבנות עם ניסים — אותו קוד שרץ במסך (crm/harel-crm.html), בלי DOM */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ נקודת איזון בהתחשבנות עם ניסים'), b = html.indexOf('/* ══ סוף נקודת איזון ══ */')
type Row = { income: number; fixed: number; direct: number; adv: number; closing: number; opening?: number; reserve?: number; released?: number }
const settleBreakEven = new Function(html.slice(a, b) + '; return settleBreakEven;')() as (r: Row, p: number, poolBefore?: number) => {
  business: number; businessGap: number; costs: number; debt: number; zero: number; zeroGap: number; above: number; owes: number; owed: number }

/** אותה התחשבנות כמו nissimCard() במצב shared: סגירה = פתיחה + מקדמות − חלקו ברווח */
const closingOf = (r: Row, p: number) => (r.opening ?? 0) + r.adv - (r.income - r.fixed - r.direct + (r.released ?? 0) - (r.reserve ?? 0)) * p

describe('נקודת ה-0 — התחשבנות עם ניסים (דן 27/10)', () => {
  it('הבלוק קיים בדף', () => { expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a) })
  it('הדוגמה של דן: חייב 50,000 במקדמות, הוצאות המחלקה 30,000 → נקודת ה-0 = 130,000', () => {
    const r = settleBreakEven({ income: 0, fixed: 25000, direct: 5000, opening: 40000, adv: 10000, closing: 50000 }, 0.5)
    expect(r.business).toBe(30000); expect(r.debt).toBe(50000); expect(r.zero).toBe(130000)
  })
  it('בנקודת ה-0 היתרה מתאפסת בדיוק; כל שקל מעליה — 50 אגורות לניסים', () => {
    const base = { fixed: 25000, direct: 5000, opening: 40000, adv: 10000 }
    for (const income of [130000, 150000]) {
      const row = { ...base, income, closing: closingOf({ ...base, income, closing: 0 }, 0.5) }
      const r = settleBreakEven(row, 0.5)
      expect(r.zeroGap).toBe(income - 130000)
      expect(r.above).toBe(r.owed)
    }
    expect(closingOf({ ...base, income: 130000, closing: 0 }, 0.5)).toBe(0)
    expect(settleBreakEven({ ...base, income: 150000, closing: -10000 }, 0.5).above).toBe(10000)
  })
  it('מתחת לנקודת ה-0 — ניסים לא מקבל, החוב נשאר', () => {
    const r = settleBreakEven({ income: 60000, fixed: 20000, direct: 5000, adv: 20000, closing: 2500 }, 0.5)
    expect(r.zero).toBe(65000); expect(r.zeroGap).toBe(-5000); expect(r.above).toBe(0)
    expect(r.owes).toBe(2500); expect(r.owed).toBe(0)
  })
  it('שריון, שחרור והחזר לדן קודם (dan_first) נכנסים לעלויות', () => {
    const r = settleBreakEven({ income: 0, fixed: 10000, direct: 0, adv: 5000, closing: 0, reserve: 3000, released: 1000 }, 0.5, 4000)
    expect(r.costs).toBe(10000 - 1000 + 3000 + 4000); expect(r.zero).toBe(16000 + 10000)
  })
  it('החברה חייבת לניסים מהחודש הקודם — אין חוב מקדמות, נקודת ה-0 = העלויות', () => {
    expect(settleBreakEven({ income: 0, fixed: 10000, direct: 0, opening: -8000, adv: 3000, closing: 0 }, 0.5).zero).toBe(10000)
  })
  it('בלי אחוז תקין — 50%', () => { expect(settleBreakEven({ income: 0, fixed: 0, direct: 0, adv: 1000, closing: 0 }, 0).zero).toBe(2000) })
})
