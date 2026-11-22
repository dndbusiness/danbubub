import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** שמאים לפי קרן (דן 22/11) — אותו קוד שרץ במסך */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ שמאים לפי קרן — פונקציה טהורה'), b = html.indexOf('/* ══ סוף שמאים לפי קרן ══ */')
const F = new Function(html.slice(a, b) + '; return { apprRank };')() as any
const A = [
  { id: '1', name: 'אבי', funds: { 'פריסבי': 'yes' }, area: 'פתח תקווה, ראש העין' },
  { id: '2', name: 'בני', funds: { 'פריסבי': 'no' }, area: 'פתח תקווה' },
  { id: '3', name: 'גדי', funds: { 'פריסבי': 'yes' }, pref: ['פריסבי'], area: 'חיפה' },
  { id: '4', name: 'דנה', area: 'פתח תקווה', maxValue: 2000000 },
]
describe('דירוג שמאים לקרן', () => {
  it('מועדף → מאושר באזור → לא ידוע → לא מאושר בסוף', () => {
    const R = F.apprRank(A, 'פריסבי', { city: 'פתח תקווה', value: 1500000 })
    expect(R.map((r: any) => r.a.name)).toEqual(['גדי', 'אבי', 'דנה', 'בני'])
    expect(R[1].areaOk).toBe(true); expect(R[2].valueOk).toBe(true); expect(R[3].st).toBe('no')
  })
  it('שווי מעל הטווח של השמאי — יורד', () => {
    const R = F.apprRank(A, 'מימון ישיר', { city: 'פתח תקווה', value: 3000000 })
    expect(R.find((r: any) => r.a.name === 'דנה').valueOk).toBe(false)
    expect(R.at(-1).a.name).toBe('דנה')
  })
  it('שם קרן עם גרש / רווחים — אותה קרן', () => expect(F.apprRank([{ id: 'x', name: 'x', funds: { 'בנק  יהב': 'yes' } }], 'בנק יהב', {})[0].st).toBe('yes'))
})
