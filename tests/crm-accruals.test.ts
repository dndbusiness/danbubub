import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** התחייבויות שעוד לא שולמו (דן 09/11) — אותו קוד שרץ במסך (crm/harel-crm.html). נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ התחייבויות שעוד לא שולמו (דן 09/11)'), b = html.indexOf('/* ══ סוף התחייבויות — פונקציות טהורות ══ */')
const helpers = "const n = (v) => Number(v || 0); const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100; const fmt0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });"
const { accrualMonth } = new Function(helpers + html.slice(a, b) + '; return { accrualMonth };')() as any

const tx = (date: string, net: number, x: object = {}) => ({ nature: 'expense', date, net: -net, deductible: true, ...x })
const A = {
  items: [
    { id: 'av10', month: '2026-10', label: 'ספק לידים — חשבון אוקטובר', amount: 17850, kind: 'marketing' },
    { id: 'av11', month: '2026-11', label: 'ספק לידים — מקדמה 50%', amount: 16000, kind: 'marketing' },
    { id: 'pay11', month: '2026-11', label: 'שכר עובדת — נובמבר', amount: 11091, kind: 'payroll', emp: 'h' },
    { id: 'gone', month: '2026-11', label: 'נמחק', amount: 999, deletedAt: 'x' },
  ],
  recur: [{ id: 'sw', label: 'תוכנות', category: 'תוכנה ומערכות', gross: 1000, vatIncl: true, from: '2026-08' }, { id: 'net', label: 'קבוע נטו', category: 'קבוע נטו', gross: 1000, from: '2026-11' }],
}
const base = { vat: 0.18, nowMonth: '2026-11', payEntered: () => false }

describe('התחייבויות שעוד לא שולמו', () => {
  it('תוכנות 1,000 כולל מע״מ: נוכה רק הפער מול מה שנרשם באותו חודש', () => {
    const txs = [tx('2026-08-31', 1000, { category: 'תוכנה ומערכות' }), tx('2026-09-30', 800, { category: 'תוכנה ומערכות' })]
    expect(accrualMonth('2026-08', A, { ...base, txs }).total).toBe(0)          // נרשם 1,000 ≥ 847.46
    expect(accrualMonth('2026-09', A, { ...base, txs }).total).toBe(47.46)      // 847.46 − 800
    expect(accrualMonth('2026-07', A, { ...base, txs }).total).toBe(0)          // לפני "החל מ"
    expect(accrualMonth('2026-12', A, { ...base, txs }).total).toBe(0)          // חודש עתידי
  })
  it('אוקטובר: חשבון הלידים 17,850 + תוכנות 847.46', () => {
    const r = accrualMonth('2026-10', A, { ...base, txs: [] })
    expect(r.items.map((i: any) => [i.id, i.net])).toEqual([['av10', 17850], ['sw:2026-10', 847.46]])
    expect(r.total).toBe(18697.46); expect(r.back).toBe(0)
  })
  it('נובמבר: מקדמה 16,000 + שכר 11,091 + תוכנות; נמחק — לא נספר', () => {
    expect(accrualMonth('2026-11', A, { ...base, txs: [] }).total).toBe(28938.46) // + קבוע נטו 1,000 (בלי סימון מע״מ = נטו)
  })
  it('שכר — יורד לבד כשהשכר של החודש הוזן', () => {
    const r = accrualMonth('2026-11', A, { ...base, txs: [], payEntered: (emp: string, m: string) => emp === 'h' && m === '2026-11' })
    expect(r.items.some((i: any) => i.id === 'pay11')).toBe(false); expect(r.total).toBe(17847.46)
  })
  it('שולם בנובמבר: נשאר נוכה באוקטובר, והתשלום מוחזר בנובמבר — לא פעמיים', () => {
    const A2 = { ...A, items: A.items.map((x) => x.id === 'av10' ? { ...x, paidTxId: 't1' } : x) }
    const txs = [tx('2026-11-05', 17850, { accrualId: 'av10', category: 'שיווק' })]
    const oct = accrualMonth('2026-10', A2, { ...base, txs }), nov = accrualMonth('2026-11', A2, { ...base, txs })
    expect(oct.items.find((i: any) => i.id === 'av10')).toMatchObject({ net: 17850, status: 'paid' })
    expect(nov.back).toBe(17850)
    // סך כל הניכוי על אוקטובר+נובמבר: התחייבויות − החזר + התשלום שבתנועות = 17,850 פעם אחת
    expect(oct.total + nov.total - nov.back + 17850).toBe(oct.total + nov.total)
  })
  it('כולל מע״מ בהתחייבות חד-פעמית → נטו', () => {
    const r = accrualMonth('2026-10', { items: [{ id: 'x', month: '2026-10', label: 'x', amount: 1180, vatIncl: true }], recur: [] }, { ...base, txs: [] })
    expect(r.total).toBe(1000)
  })
})
