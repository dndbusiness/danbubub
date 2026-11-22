import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** מוכנות להגשה (דן 22/11) — אותו קוד שרץ במסך */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ מוכנות להגשה — פונקציה טהורה'), b = html.indexOf('/* ══ סוף מוכנות להגשה ══ */')
const F = new Function(html.slice(a, b) + '; return { readyCalc };')() as any
const base = { poa: ['לאומי', 'הפועלים', 'דיסקונט', 'מזרחי'].map((l) => ({ label: l, ok: false })), data: [{ label: 'סכום', ok: true }, ...Array.from({ length: 5 }, () => ({ label: 'x', ok: false }))], pti: null, ltv: null, ltvMax: 0.75, regs: [{ label: 'a', ok: true }, { label: 'b', ok: false }, { label: 'c', ok: true }], docs: [] }

describe('מוכנות להגשה', () => {
  it('תיק חדש: אחוז לפי פריטים, הצעד הבא = הקטגוריה עם הכי הרבה חסרים', () => {
    const R = F.readyCalc(base)
    expect(R.digital.cats.map((c: any) => [c.key, c.done, c.tot])).toEqual([['poa', 0, 4], ['data', 1, 6], ['pti', 0, 1], ['ltv', 0, 1], ['reg', 2, 3]])
    expect(R.digital.pct).toBe(20) // 3 מתוך 15
    expect(R.next).toEqual({ key: 'data', label: 'נתוני הבקשה', gain: 33 })
  })
  it('יחס החזר: עד 40% תקין, 40–50 לטיפול (חצי), מעל 50 חסר', () => {
    expect(F.readyCalc({ ...base, pti: 0.35 }).digital.cats[2].done).toBe(1)
    const w = F.readyCalc({ ...base, pti: 0.45 }).digital.cats[2]; expect([w.warn, w.missing, w.pct]).toEqual([1, 0, 50])
    expect(F.readyCalc({ ...base, pti: 0.55 }).digital.cats[2].missing).toBe(1)
  })
  it('אחוז מימון מול המגבלה; עם מסמכים — המסמכים נספרים', () => {
    expect(F.readyCalc({ ...base, ltv: 0.8 }).digital.cats[3].missing).toBe(1)
    expect(F.readyCalc({ ...base, ltv: 0.6 }).digital.cats[3].done).toBe(1)
    const R = F.readyCalc({ ...base, docs: [{ label: 'ת״ז', ok: true }, { label: 'תלוש', ok: false }] })
    expect(R.full.cats.at(-1)).toMatchObject({ key: 'docs', done: 1, tot: 2 }); expect(R.full.pct).toBe(24) // 4 מתוך 17
  })
})
