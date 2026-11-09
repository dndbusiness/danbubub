import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** שכר ב-CRM — רכיבים גמישים (דן 07/11). אותו קוד שרץ במסך (crm/harel-crm.html). נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ שכר — רכיבים (דן 07/11'), b = html.indexOf('/* ══ סוף שכר — פונקציות טהורות ══ */')
const helpers = "const n = (v) => Number(v || 0); const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100; const fmt0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });"
const F = new Function(helpers + html.slice(a, b) + '; return { payCalc, payComps, payUnitsOf };')() as any

describe('עובד ישן (שדות קבועים) — אותו חישוב כמו קודם', () => {
  const e = { key: 'h', name: 'עובדת א', hourly: 50, perZoom: 30, perClose: 200, travelDay: 20, fixedBonus: 500, fixedBonusNote: 'בונוס התמדה', employerPct: 10 }
  it('הרכיבים מומרים ליחידות הישנות, והחודש שנשמר נקרא כמו שהוא', () => {
    expect(F.payUnitsOf(e)).toEqual(['hours', 'zooms', 'closes', 'days'])
    const c = F.payCalc(e, { hours: 100, zooms: 2, closes: 1, days: 10, extra: 150 })
    // 5000 + 60 + 200 + 200 + 500 + 150 = 6110 ; עלות מעביד 10% = 611
    expect(c.rows.map((r: any) => r.sum)).toEqual([5000, 60, 200, 200, 500, 150, 611])
    expect(c.total).toBe(6721)
  })
  it('"חודש מלא" כבוי (fullMonth=false) — בלי הבונוס הקבוע; הזנה חדשה (q) גוברת על השדה הישן', () => {
    expect(F.payCalc(e, { fullMonth: false, hours: 10 }).rows.find((r: any) => r.label === 'בונוס התמדה').sum).toBe(0)
    expect(F.payCalc(e, { hours: 10, q: { hours: 12 } }).rows[0].sum).toBe(600)
  })
})

describe('נציג חדש — רכיבים לפי ההסכם', () => {
  const rep = { key: 'r', name: 'נציג Test', floor: 6000, employerPct: 0, components: [
    { id: 'c1', type: 'rate', label: 'שעות', unit: 'hours', rate: 40 },
    { id: 'c2', type: 'rate', label: 'עמלה לסגירה', unit: 'closes', rate: 300 },
    { id: 'c3', type: 'tier', label: 'בונוס יעד', unit: 'closes', threshold: 8, bonus: 1000 },
    { id: 'c4', type: 'pct', label: 'אחוז מהשכ״ט', pct: 5 },
    { id: 'c5', type: 'fixed', label: 'דמי נסיעות', amount: 400 },
  ] }
  it('תעריף × כמות, יעד שהושג, אחוז מסכום, סכום קבוע', () => {
    const c = F.payCalc(rep, { q: { hours: 160, closes: 8 }, base: { c4: 20000 } })
    expect(c.rows.map((r: any) => [r.label, r.sum])).toEqual([['שעות', 6400], ['עמלה לסגירה', 2400], ['בונוס יעד', 1000], ['אחוז מהשכ״ט', 1000], ['דמי נסיעות', 400]])
    expect(c.total).toBe(11200)
    expect(c.rows[2].how).toMatch(/מתוך יעד 8 סגירות — הגיע/)
  })
  it('יעד שלא הושג — 0; חצי חודש בסכום הקבוע; השלמה לרצפה', () => {
    const c = F.payCalc(rep, { q: { hours: 80, closes: 3 }, part: { c5: 50 } })
    // 3200 + 900 + 0 + 0 + 200 = 4300 → השלמה ל-6000 = 1700
    expect(c.rows.find((r: any) => r.label === 'בונוס יעד').sum).toBe(0)
    expect(c.rows.find((r: any) => r.label === 'דמי נסיעות').sum).toBe(200)
    expect(c.rows.at(-1)).toMatchObject({ label: 'השלמה לרצפה (6,000)', sum: 1700 })
    expect(c.total).toBe(6000)
  })
  it('בלי הזנה לחודש — אין השלמה (העובד לא התחיל); ביטול השלמה בחודש מסוים', () => {
    expect(F.payCalc(rep, {}).total).toBe(400)
    expect(F.payCalc(rep, { q: { hours: 10 }, noFloor: true }).rows.some((r: any) => /השלמה/.test(r.label))).toBe(false)
  })
  it('עלות מעביד על כל הברוטו (כולל השלמה)', () => {
    const c = F.payCalc({ ...rep, employerPct: 10 }, { q: { hours: 100 } })
    // 4000 + 400 = 4400 → השלמה 1600 → 6000 ; 10% = 600
    expect(c.rows.at(-1)).toMatchObject({ sum: 600 }); expect(c.total).toBe(6600)
  })
})

describe('עלות מעביד בפועל ובדיקת כפילויות (דן 09/11)', () => {
  const G = new Function(helpers + html.slice(a, b) + '; return { payEmployerSplit, dupExpensePairs, payCalc };')() as any
  it('2,200 על ספטמבר (9,000) ואוקטובר (11,000) → 11% ופיזור מדויק', () => {
    const R = G.payEmployerSplit(2200, [{ month: '2026-09', gross: 9000 }, { month: '2026-10', gross: 11000 }])
    expect(R.pct).toBe(11); expect(R.alloc.map((x: any) => x.amount)).toEqual([990, 1210])
    const R2 = G.payEmployerSplit(1000, [{ month: 'a', gross: 1 }, { month: 'b', gross: 1 }, { month: 'c', gross: 1 }])
    expect(R2.alloc.reduce((s: number, x: any) => s + x.amount, 0)).toBe(1000)
    expect(G.payEmployerSplit(100, [])).toBe(null)
  })
  it('employerAmt בחודש גובר על האחוז; 0 = בלי עלות מעביד בחודש', () => {
    const e = { components: [{ id: 'c', type: 'fixed', amount: 9000 }], employerPct: 20 }
    expect(G.payCalc(e, { employerAmt: 990 }).total).toBe(9990)
    expect(G.payCalc(e, { employerAmt: 0 }).total).toBe(9000)
    expect(G.payCalc(e, {}).total).toBe(10800)
  })
  it('אותו סכום ואותו ספק תוך 10 ימים = כפילות; ספק אחר / מעל 10 ימים / "לא כפילות" — לא', () => {
    const t = (id: string, date: string, net: number, cp: string, x: object = {}) => ({ id, nature: 'expense', date, net: -net, counterparty: cp, ...x })
    const P = G.dupExpensePairs([t('1', '2026-10-22', 3768, 'פייסבוק הלוואות רכב'), t('2', '2026-10-25', 3768, 'פייסבוק הלוואות-רכב'), t('3', '2026-10-22', 3768, 'ספק אחר'), t('4', '2026-11-20', 3768, 'פייסבוק הלוואות רכב')])
    expect(P.map((p: any) => p.map((x: any) => x.id))).toEqual([['1', '2']])
    expect(G.dupExpensePairs([t('1', '2026-10-22', 100, 'X', { notDup: ['2'] }), t('2', '2026-10-23', 100, 'X')])).toEqual([])
  })
})
