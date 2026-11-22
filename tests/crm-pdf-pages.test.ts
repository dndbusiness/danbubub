import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** עמודי PDF (דן 22/11: "דף A4 מסודר, לא חלקי דף") — אותו קוד שרץ במסך */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ עמודי PDF — פונקציה טהורה'), b = html.indexOf('/* ══ סוף עמודי PDF ══ */')
const F = new Function(html.slice(a, b) + '; return { pdfBreaks };')() as any

describe('שבירת עמודים רק בין כרטיסים שלמים', () => {
  const card = (top: number, h: number, head = false) => ({ top, bottom: top + h, h: head })
  it('כרטיס שלא נכנס עובר שלם לעמוד הבא — אף כרטיס לא נחתך', () => {
    const U = [card(0, 300), card(310, 300), card(620, 300), card(930, 300)], P = F.pdfBreaks(U, 1230, 1000)
    expect(P).toEqual([[0, 930], [930, 1230]])
    for (const u of U) expect(P.some(([f, t]: [number, number]) => u.top >= f && u.bottom <= t)).toBe(true)
  })
  it('כותרת שלב לא נשארת לבד בתחתית — עוברת עם הכרטיס שאחריה', () => {
    const P = F.pdfBreaks([card(0, 800), card(820, 40, true), card(870, 300)], 1170, 1000)
    expect(P).toEqual([[0, 820], [820, 1170]])
  })
  it('כרטיס גבוה מעמוד — רק הוא נחתך', () => {
    expect(F.pdfBreaks([card(0, 100), card(110, 2100)], 2210, 1000)).toEqual([[0, 110], [110, 1110], [1110, 2110], [2110, 2210]])
  })
})

describe('תמונה → PDF: עמוד A4 לפי כיוון התמונה', () => {
  const G = new Function(html.slice(a, b) + '; return { imgFit };')() as any
  it('תמונה לאורך (טלפון) — עמוד לאורך, נכנסת בשוליים ובמרכז', () => {
    const F = G.imgFit(1200, 1600)
    expect(F.land).toBe(false)
    expect(F.x).toBeGreaterThanOrEqual(18); expect(F.y).toBeGreaterThanOrEqual(18)
    expect(F.x + F.w).toBeLessThanOrEqual(F.pw - 18 + 1e-9); expect(F.y + F.h).toBeLessThanOrEqual(F.ph - 18 + 1e-9)
    expect(Math.abs(F.w / F.h - 1200 / 1600)).toBeLessThan(1e-9)
  })
  it('תמונה לרוחב — עמוד לרוחב', () => { const F = G.imgFit(1600, 900); expect(F.land).toBe(true); expect(F.pw).toBeGreaterThan(F.ph) })
  it('תמונה קטנה לא מנופחת מעבר לפי 2', () => { const F = G.imgFit(100, 120); expect(F.w).toBe(200); expect(F.h).toBe(240) })
})
