import { describe, expect, it } from 'vitest'
import { click2callOk, click2callUrl, dialable, extOf, repMap } from '@/lib/rules/voicenter'

const s = { ownerExt: '101', users: [{ username: 'Hadas', resp: 'hadas', ext: '102' }, { username: 'eden', ext: ' 103 ' }], voicenterReps: { 'עדן כהן': 'eden' } }

describe('וויאסנטר', () => {
  it('שלוחה → עובד, כולל דן ומיפוי ידני', () => {
    expect(repMap(s)).toEqual({ '101': 'dan', '102': 'hadas', '103': 'eden', 'עדן כהן': 'eden' })
  })
  it('השלוחה של מי שנכנס', () => {
    expect(extOf(s, 'dan')).toBe('101'); expect(extOf(s, 'eden')).toBe('103'); expect(extOf(s, 'nissim')).toBeNull()
  })
  it('מספר לחיוג', () => {
    expect(dialable('+972-52-123-4567')).toBe('0521234567'); expect(dialable('052-1234567')).toBe('0521234567'); expect(dialable('123')).toBeNull()
  })
  it('כתובת click2call', () => {
    expect(click2callUrl('C0DE', '101', '0521234567')).toBe('https://api.voicenter.com/ForwardDialer/click2call.aspx?phone=101&target=0521234567&code=C0DE&action=call')
  })
  it('תשובה', () => {
    expect(click2callOk(200, '<root><ERRORCODE>0</ERRORCODE></root>').ok).toBe(true)
    expect(click2callOk(200, '<root><ERRORCODE>5</ERRORCODE><ERRORMESSAGE>Invalid code</ERRORMESSAGE></root>')).toEqual({ ok: false, message: 'Invalid code' })
    expect(click2callOk(500, '').ok).toBe(false)
    expect(click2callOk(200, '{"ERRORCODE":0}').ok).toBe(true)
  })
})
