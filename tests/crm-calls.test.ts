import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** שיחות חזרה מתואמות למתעניינים — אותו קוד שרץ במסך (crm/harel-crm.html). נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ שיחות חזרה מתואמות (דן 04/11)'), b = html.indexOf('/* ══ סוף שיחות חזרה — פונקציות טהורות ══ */')
const F = new Function(html.slice(a, b) + '; return { callAlertStage, callAgenda, callAtOf, isCallTask };')() as any

describe('התראה על מסך מלא — 10 דק׳ לפני, 5 דק׳ לפני ובשעה', () => {
  const at = '2026-11-04T14:30'
  it('לפני חלון ההתראות — כלום', () => { expect(F.callAlertStage(at, '2026-11-04T14:19')).toBe(null) })
  it('10 דקות לפני (ועד שנשארו 5) — שלב 10', () => {
    expect(F.callAlertStage(at, '2026-11-04T14:20')).toBe(10); expect(F.callAlertStage(at, '2026-11-04T14:24')).toBe(10)
  })
  it('5 דקות לפני ועד השעה — שלב 5', () => { expect(F.callAlertStage(at, '2026-11-04T14:25')).toBe(5); expect(F.callAlertStage(at, '2026-11-04T14:29')).toBe(5) })
  it('בשעה עצמה ועד חצי שעה אחרי — שלב 0; אחר כך כלום (נשאר "באיחור" ביומן)', () => {
    expect(F.callAlertStage(at, '2026-11-04T14:30')).toBe(0); expect(F.callAlertStage(at, '2026-11-04T15:00')).toBe(0); expect(F.callAlertStage(at, '2026-11-04T15:01')).toBe(null)
  })
  it('מעבר חצות: שיחה ב-00:05, עכשיו 23:57 אתמול — שלב 10', () => { expect(F.callAlertStage('2026-11-05T00:05', '2026-11-04T23:57')).toBe(10) })
})

describe('יומן היום — למי לחזור ומתי', () => {
  const call = (id: string, time: string, x: object = {}) => ({ id, kind: 'call', leadId: 'L' + id, due: '2026-11-04', time, status: 'open', ...x })
  const tasks = [
    call('a', '16:00'), call('b', '09:30', { status: 'done' }), call('c', '11:00'), call('d', '12:10'),
    call('e', '13:00', { cancelled: true, cancelReason: 'הלקוח ביקש לדחות', deletedAt: 'x' }), call('f', '14:00', { deletedAt: 'x' }),
    call('g', '10:00', { due: '2026-11-05' }), { id: 'h', title: 'משימה רגילה', due: '2026-11-04', time: '08:00', status: 'open' },
  ]
  const R = F.callAgenda(tasks, '2026-11-04', '2026-11-04T12:02')
  it('רק שיחות של היום, לפי השעה; משימה רגילה / יום אחר / נמחקה בלי ביטול — לא', () => { expect(R.map((r: any) => r.t.id)).toEqual(['b', 'c', 'd', 'e', 'a']) })
  it('מצב לכל שיחה: בוצעה / באיחור / עכשיו (עד 10 דק׳) / בוטלה עם הסיבה / בהמשך', () => {
    expect(R.map((r: any) => r.state)).toEqual(['done', 'late', 'soon', 'cancelled', 'later'])
    expect(R.find((r: any) => r.t.id === 'd').inMin).toBe(8)
    expect(R.find((r: any) => r.t.id === 'e').t.cancelReason).toBe('הלקוח ביקש לדחות')
  })
  it('callAtOf / isCallTask', () => {
    expect(F.callAtOf(call('x', '09:05'))).toBe('2026-11-04T09:05'); expect(F.callAtOf({ due: '2026-11-04' })).toBe(null)
    expect(F.isCallTask(call('x', '09:05'))).toBe(true); expect(F.isCallTask({ kind: 'call' })).toBe(false)
  })
})
