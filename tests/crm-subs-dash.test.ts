import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** לוח הגשות (דן 22/11) — אותו קוד שרץ במסך */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ לוח הגשות — פונקציות טהורות'), b = html.indexOf('/* ══ סוף לוח הגשות ══ */')
const F = new Function(html.slice(a, b) + '; return { subDashStats, subDashMonths };')() as any
const R = [
  { date: '2026-08-03', g: 'approved', bank: 'פמה', client: 'a' }, { date: '2026-08-04', g: 'declined', bank: 'מימון ישיר', client: 'a' },
  { date: '2026-08-20', g: 'submitted', bank: 'פמה', client: 'b' }, { date: '2026-10-01', g: 'executed', bank: 'פריסבי', client: 'c' },
  { date: '2026-10-02', g: 'prep', bank: 'פמה', client: 'c' }, { date: '2025-12-01', g: 'approved', bank: 'פמה', client: 'z' },
]
describe('לוח הגשות', () => {
  it('מדדים: בלי "בהכנה"; אחוז אישור מתוך מי שקיבל תשובה', () => {
    const K = F.subDashStats(R, '2026-01-01', '2026-11-22', '2025-01-01')
    expect(K).toEqual({ n: 4, prev: 1, approved: 2, executed: 1, declined: 1, pending: 1, rate: 67, clients: 3 })
  })
  it('לפי חודש: כל חודש בטווח, גם ריק, עם לקוחות שונים', () => {
    const M = F.subDashMonths(R, '2026-08-01', '2026-10-31', (r: any) => r.g)
    expect(M.map((x: any) => [x.m, x.n, x.clients])).toEqual([['2026-08', 3, 2], ['2026-09', 0, 0], ['2026-10', 1, 1]])
    expect(M[0].by).toEqual({ approved: 1, declined: 1, submitted: 1 })
  })
})
