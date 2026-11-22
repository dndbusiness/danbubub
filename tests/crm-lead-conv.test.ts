import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** לידים: סנכרון לפי פלטפורמה + המרה קפדנית לפי קמפיין (דן 22/11) — אותו קוד שרץ במסך */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ לידים — סנכרון לפי פלטפורמה'), b = html.indexOf('/* ══ סוף לידים — סנכרון והמרה ══ */')
const F = new Function(html.slice(a, b) + '; return { syncHealth, convRows };')() as any
const NOW = Date.parse('2026-11-22T12:00:00Z'), ago = (h: number) => new Date(NOW - h * 36e5).toISOString()

describe('סנכרון לפי פלטפורמה', () => {
  it('פלטפורמה שמביאה ליד כל כמה שעות ונעצרה 3 ימים — "לבדוק"; אחת שזורמת — תקין', () => {
    const fb = Array.from({ length: 60 }, (_, i) => ({ platform: 'פייסבוק', at: ago(72 + i * 10) }))
    const tk = Array.from({ length: 30 }, (_, i) => ({ platform: 'טיקטוק', at: ago(2 + i * 20) }))
    const H = F.syncHealth([...fb, ...tk], NOW)
    expect(H[0].platform).toBe('פייסבוק'); expect(H[0].st).toBe('stale'); expect(H[0].idleH).toBe(72)
    expect(H.find((h: any) => h.platform === 'טיקטוק').st).toBe('ok')
  })
  it('פלטפורמה נדירה (ליד בשבוע) — יומיים בלי ליד זה עדיין תקין', () => {
    const H = F.syncHealth([{ platform: 'גוגל', at: ago(60) }, { platform: 'גוגל', at: ago(240) }, { platform: 'גוגל', at: ago(400) }], NOW)
    expect(H[0].st).toBe('ok')
  })
  it('בלי ליד 30 יום — לא פעיל', () => expect(F.syncHealth([{ platform: 'ישן', at: ago(800) }], NOW)[0].st).toBe('idle'))
})

describe('המרה קפדנית', () => {
  const it0 = (o: any) => ({ platform: 'פייסבוק', campaign: 'רכב', at: ago(5), credit: false, reached: true, signed: false, paid: false, fee: 0, collected: 0, cost: 0, ...o })
  const items = [it0({}), it0({ credit: true, cost: 160 }), it0({ reached: false }), it0({ signed: true, fee: 5000 }), it0({ signed: true, paid: true, fee: 4000, collected: 4000 }), it0({ campaign: 'נכסים' })]
  it('המכנה = תקינים בלבד; חתם = נפתח לקוח; ההוצאה מהקמפיין', () => {
    const R = F.convRows(items, (p: string, c: string) => (c === 'רכב' ? 2000 : 0))
    const car = R.find((r: any) => r.campaign === 'רכב')
    expect([car.leads, car.credit, car.valid, car.reached, car.signed, car.paid]).toEqual([5, 1, 4, 3, 2, 1])
    expect([car.reachPct, car.signPct, car.payPct]).toEqual([75, 50, 25])
    expect([car.spend, car.cpl, car.cps, car.collected, car.roi]).toEqual([2000, 500, 1000, 4000, 100])
  })
  it('בלי הוצאה בקמפיין — עלות הלידים מהספק (גם לידים לזיכוי)', () => {
    const R = F.convRows([it0({ cost: 160 }), it0({ cost: 160, credit: true })], () => 0)
    expect(R[0].spend).toBe(320); expect(R[0].cpl).toBe(320)
  })
})
