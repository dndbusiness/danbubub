import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** תיעוד שיחות ממתעניין → "הכר את הלקוח" (דן 22/11) — אותו קוד שרץ במסך */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ תיעוד שיחות → "הכר את הלקוח"'), b = html.indexOf('/* ══ סוף תיעוד שיחות ══ */')
const F = new Function(html.slice(a, b) + '; return { leadNotesMerge };')() as any

describe('הערות מהשיחות נכנסות למלל החופשי פעם אחת', () => {
  const E = [{ key: 'n:1', at: '2026-11-20T10:05:00Z', text: 'נשוי + 2, דירה בפ״ת' }, { key: 'c:9', at: '2026-11-19T09:00:00Z', text: '📞 ביקש 400 אלף' }]
  it('לפי הסדר בזמן, עם תאריך, מתחת למה שכבר נכתב', () => {
    const r = F.leadNotesMerge('כתבתי ביד', E, [])
    expect(r.text).toBe('כתבתי ביד\n\n— מהשיחות עם המתעניין —\n[19/11 09:00] 📞 ביקש 400 אלף\n[20/11 10:05] נשוי + 2, דירה בפ״ת')
    expect(r.done).toEqual(['c:9', 'n:1'])
  })
  it('ריצה חוזרת — לא מכפיל', () => {
    const r = F.leadNotesMerge('x', E, []), r2 = F.leadNotesMerge(r.text, E, r.done)
    expect(r2).toBeNull()
  })
  it('הערה חדשה — נוספת בסוף בלי כותרת נוספת', () => {
    const r = F.leadNotesMerge('', E, [])
    const r2 = F.leadNotesMerge(r.text, [...E, { key: 'n:2', at: '2026-11-21T08:00:00Z', text: 'שלח תלושים' }], r.done)
    expect(r2.text.endsWith('[21/11 08:00] שלח תלושים')).toBe(true)
    expect(r2.text.split('— מהשיחות עם המתעניין —').length).toBe(2)
  })
})
