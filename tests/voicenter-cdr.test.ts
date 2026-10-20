import { describe, expect, it } from 'vitest'
import { callStatusHe, click2callBody, click2callResult, customOf, israelWallEpochToIso, leadCallRec, missedNeedsTask, normalizePhone, parseCdr, popupAnswer } from '@/lib/rules/voicenter-cdr'

const now = new Date('2026-10-20T10:00:00Z')
// 20/10/2026 14:30:00 שעון ישראל (קיץ, +3) = 11:30Z. ה-epoch של וויאסנטר = שעון הקיר כאילו UTC
const wall = Date.UTC(2026, 9, 20, 14, 30, 0) / 1000

describe('וויאסנטר — CDR', () => {
  it('טלפון אחד לכל הפורמטים', () => {
    for (const p of ['972501234567', '+972-50-123-4567', '050-1234567', '501234567']) expect(normalizePhone(p)).toBe('0501234567')
  })
  it('זמן: שעון ישראל → UTC (קיץ +3, חורף +2)', () => {
    expect(israelWallEpochToIso(wall)).toBe('2026-10-20T11:30:00.000Z')
    expect(israelWallEpochToIso(Date.UTC(2026, 0, 15, 9, 0, 0) / 1000)).toBe('2026-01-15T07:00:00.000Z')
  })
  it('שיחה נכנסת שנענתה — אותיות לא משנות, הלקוח = המתקשר', () => {
    const c = parseCdr({ IVRUNIQUEID: 'abc.1', Direction: 'Incoming', type: 'Incoming Call', status: 'ANSWER', isAnswer: 1, callerPhone: '972521112222', target: '0733333333', did: '0733333333',
      time: wall, duration: 95, actualCallDuration: 80, dialtime: 15, targetextension: 'SIP101', representative_name: 'הדס', record: 'https://cpanel.voicenter.co.il/rec/1.mp3', price: 12 }, now)
    if ('error' in c) throw new Error(c.error)
    expect(c).toMatchObject({ ivr: 'abc.1', dir: 'in', answered: true, customer: '0521112222', ext: 'SIP101', at: '2026-10-20T11:30:00.000Z', talkSec: 80, ringSec: 15, priceAgorot: 12, hidden: false, leg: null })
    expect(callStatusHe(c)).toBe('נענתה')
    expect(leadCallRec(c, 'hadas')).toMatchObject({ id: 'vc-abc.1', kind: 'effective', dir: 'in', by: 'hadas', rec: 'https://cpanel.voicenter.co.il/rec/1.mp3' })
  })
  it('יוצאת — הלקוח = היעד; Click2Call leg1 מוסתר, leg2 מוצג; var_leadId גובר', () => {
    const l1 = parseCdr({ ivruniqueid: 'x1', type: 'Click2Call leg1', direction: 'out', target: 'SIP101', status: 'ANSWER', var_leadId: 'L9' }, now) as ReturnType<typeof parseCdr> & { hidden: boolean }
    const l2 = parseCdr({ ivruniqueid: 'x2', type: 'Click2Call leg2', direction: 'Outgoing', callerextension: 'SIP101', target: '0501234567', status: 'NOANSWER', isAnswer: 0, CustomData: '{"var_leadId":"L9"}' }, now)
    if ('error' in l1 || 'error' in l2) throw new Error()
    expect(l1.hidden).toBe(true); expect(l2.hidden).toBe(false)
    expect(l2).toMatchObject({ dir: 'out', customer: '0501234567', ext: 'SIP101', leadId: 'L9', answered: false })
    expect(callStatusHe(l2)).toBe('לא נענתה')
  })
  it('בלי ivruniqueid — שגיאה; משימת חזרה רק לנכנסת שלא נענתה', () => {
    expect(parseCdr({ status: 'ANSWER' }, now)).toEqual({ error: 'חסר ivruniqueid' })
    const m = parseCdr({ ivruniqueid: 'm', type: 'Queue', status: 'ABANDONE', isAnswer: 0, caller: '0501234567' }, now)
    if ('error' in m) throw new Error()
    expect(m.dir).toBe('in'); expect(missedNeedsTask(m)).toBe(true); expect(callStatusHe(m)).toBe('ננטשה בתור')
  })
  it('CustomData + var_* בשורש', () => {
    expect(customOf({ CustomData: { leadId: '5' }, var_userId: '7', other: 1 })).toEqual({ leadId: '5', var_userId: '7' })
  })
})

describe('וויאסנטר — Pop-Up ו-Click2Call', () => {
  it('Pop-Up: ליד קיים / חדש', () => {
    expect(popupAnswer({ base: 'https://x.app', lead: { id: 'L1', name: 'ישראל' }, total: 1, phone: '0501234567', stageLabel: 'אישור עקרוני', respLabel: 'הדס' }))
      .toEqual({ STATUS: 'OK', URL: 'https://x.app/crm#lead:L1', CLIENTNAME: 'ישראל', TOTAL: 1, COMPANY: 'שלב: אישור עקרוני · אחראי: הדס' })
    expect(popupAnswer({ base: 'https://x.app', lead: null, total: 0, phone: '0501234567' })).toMatchObject({ STATUS: 'OK', CLIENTNAME: 'לקוח חדש', URL: 'https://x.app/crm#newlead:0501234567' })
  })
  it('Click2Call: גוף הבקשה ותשובות', () => {
    expect(click2callBody('C', 'SIP1', '0501234567', { leadId: 'L1', userId: 'hadas' })).toEqual({ code: 'C', action: 'call', phone: 'SIP1', target: '0501234567', record: 'true', format: 'json', checkphonedevicestate: 'true', var_leadId: 'L1', var_userId: 'hadas' })
    expect(click2callResult(200, '{"ERRORCODE":0,"ERRORMESSAGE":"OK","CALLID":"77"}')).toMatchObject({ ok: true, callId: '77' })
    expect(click2callResult(200, '{"ERRORCODE":3,"ERRORMESSAGE":"Device"}')).toMatchObject({ ok: false, message: 'השלוחה שלך לא מחוברת — פתח את הטלפון או את האפליקציה' })
    expect(click2callResult(500, '').ok).toBe(false)
  })
})
