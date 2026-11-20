import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** חבילות לידים (דן 20/11) — אותו קוד שרץ במסך (crm/harel-crm.html). נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ חבילות לידים — פונקציות טהורות'), b = html.indexOf('/* ══ סוף חבילות לידים — פונקציות טהורות ══ */')
const F = new Function(html.slice(a, b) + '; return { termsPrice, pkgAssign, pkgMoney };')() as any
const L = (id: string, at: string, credit = false) => ({ id, at, credit })

describe('מחיר לליד לפי חודש', () => {
  const T = [{ from: '2026-11', price: 160 }]
  it('מנובמבר 160; חודשים קודמים — המחיר הישן', () => {
    expect(F.termsPrice(T, '2026-11', 150)).toBe(160)
    expect(F.termsPrice(T, '2026-12', 150)).toBe(160)
    expect(F.termsPrice(T, '2026-10', 150)).toBe(150)
    expect(F.termsPrice([], '2026-11', 150)).toBe(150)
  })
  it('כמה שינויים — האחרון שחל', () => {
    expect(F.termsPrice([{ from: '2027-01', price: 170 }, { from: '2026-11', price: 160 }], '2027-02', 150)).toBe(170)
  })
})

describe('חבילה: לזיכוי מוחלף בליד חלופי, לא בכסף', () => {
  const pk = { id: 'p1', start: '2026-11-01', leads: 3, price: 160 }
  it('ליד לזיכוי לא נספר — החבילה נגמרת אחרי 3 טובים; מה שלפני החבילה — לחוד', () => {
    const r = F.pkgAssign([pk], [L('a', '2026-10-30'), L('b', '2026-11-02'), L('c', '2026-11-03', true), L('d', '2026-11-05'), L('e', '2026-11-09'), L('f', '2026-11-12')])
    expect(r.before).toEqual(['a'])
    expect(r.pkgs[0]).toMatchObject({ good: ['b', 'd', 'e'], credit: ['c'], remaining: 0, done: true, doneAt: '2026-11-09' })
    expect(r.extra).toEqual(['f'])
  })
  it('חבילה שנייה מתמלאת רק אחרי הראשונה', () => {
    const r = F.pkgAssign([pk, { id: 'p2', start: '2026-11-04', leads: 2, price: 160 }], [L('b', '2026-11-02'), L('d', '2026-11-05'), L('e', '2026-11-06'), L('g', '2026-11-07')])
    expect(r.pkgs[0].good).toEqual(['b', 'd', 'e']); expect(r.pkgs[1].good).toEqual(['g']); expect(r.pkgs[1].remaining).toBe(1)
  })
  it('חבילה מחוקה לא נספרת', () => {
    expect(F.pkgAssign([{ ...pk, deletedAt: 'x' }], [L('b', '2026-11-02')]).before).toEqual(['b'])
  })
})

describe('כסף: 50% בתחילת החבילה, 50% בסוף', () => {
  const pk = { start: '2026-11-01', leads: 200, price: 160 }
  it('200 × 160 = 32,000 · מקדמה 16,000 עכשיו · היתרה רק בסוף', () => {
    const M = F.pkgMoney(pk, { done: false }, 0)
    expect(M).toMatchObject({ amount: 32000, adv: 16000, fin: 16000, advLeft: 16000, finLeft: 16000, dueNow: 16000, finDue: null })
  })
  it('שולמה מקדמה → כלום עכשיו; בסוף החבילה → היתרה לתשלום', () => {
    expect(F.pkgMoney(pk, { done: false }, 16000)).toMatchObject({ advLeft: 0, finLeft: 16000, dueNow: 0 })
    expect(F.pkgMoney(pk, { done: true, doneAt: '2026-11-28' }, 16000)).toMatchObject({ dueNow: 16000, finDue: '2026-11-28' })
    expect(F.pkgMoney(pk, { done: true }, 32000)).toMatchObject({ dueNow: 0, over: 0 })
  })
})
