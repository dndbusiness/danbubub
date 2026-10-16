import { describe, expect, it } from 'vitest'
import { callFromVoicenter, keyOk, leadFromPayload, normPhone, phoneVariants } from '@/lib/crm/inbound'

describe('לידים ממערכות חיצוניות', () => {
  const now = new Date('2026-10-15T18:03:00Z')
  it('גוף חופשי → ליד: טלפון מנורמל, חברה, תשובות, ניסים כברירת מחדל בפתרונות', () => {
    const r = leadFromPayload({ full_name: 'ישראל ישראלי', phone_number: '+972 54-123-4567', campaign: 'רכב אוקטובר', source: 'פייסבוק', 'יש רכב בשנתון?': 'כן', key: 'x' }, now)
    if ('error' in r) throw new Error(r.error)
    expect(r.doc.phone).toBe('0541234567'); expect(r.doc.division).toBe('finance'); expect(r.doc.resp).toBe('nissim')
    expect(r.doc.answers).toEqual({ 'יש רכב בשנתון?': 'כן' }); expect(r.doc.stage).toBe('new')
  })
  it('אותו ליד באותן 10 דקות = אותו מזהה (שליחה חוזרת לא יוצרת כפיל)', () => {
    const a = leadFromPayload({ name: 'א', phone: '0541234567', source: 'זאפייר' }, now), b = leadFromPayload({ name: 'א', phone: '054-1234567', source: 'זאפייר' }, new Date('2026-10-15T18:08:00Z'))
    expect('id' in a && 'id' in b && a.id === b.id).toBe(true)
  })
  it('נדל״ן לפי שדה החברה; בלי שם וטלפון — שגיאה', () => {
    const r = leadFromPayload({ name: 'ב', phone: '0521111111', division: 'השקעות' }, now)
    expect('doc' in r && r.doc.division).toBe('realestate')
    expect('error' in leadFromPayload({ campaign: 'x' }, now)).toBe(true)
  })
  it('מפתח: השוואה בזמן קבוע, ריק = לא', () => { expect(keyOk('abc', 'abc')).toBe(true); expect(keyOk('abd', 'abc')).toBe(false); expect(keyOk('', 'abc')).toBe(false); expect(keyOk('abc', undefined)).toBe(false) })
  it('טלפונים', () => { expect(normPhone('541234567')).toBe('0541234567'); expect(phoneVariants('0541234567')).toEqual(['0541234567', '541234567', '972541234567']) })
})

describe('וויאסנטר — שיחה לליד', () => {
  it('יוצאת, 75 שניות → אפקטיבית; נציג ממופה למשתמש', () => {
    const r = callFromVoicenter({ CallID: 'c1', Type: 'Outgoing Call', caller: '039999999', target: '0541234567', Duration: 75, DialStatus: 'ANSWER', time: 1760550000, RepresentativeName: 'עדן' }, { 'עדן': 'eden' })
    if ('error' in r) throw new Error(r.error)
    expect(r.phones[0]).toBe('0541234567'); expect(r.call.kind).toBe('effective'); expect(r.call.by).toBe('eden'); expect(r.call.id).toBe('vc-c1')
  })
  it('20 שניות → הרמה; בלי מענה → לא ענה', () => {
    const a = callFromVoicenter({ CallID: 'c2', type: 'outgoing', target: '0541234567', Duration: 20, DialStatus: 'ANSWER' })
    const b = callFromVoicenter({ CallID: 'c3', type: 'outgoing', target: '0541234567', Duration: 0, DialStatus: 'NOANSWER' })
    expect('call' in a && a.call.kind).toBe('pickup'); expect('call' in b && b.call.kind).toBe('none')
  })
  it('נכנסת — המספר של המתקשר', () => {
    const r = callFromVoicenter({ CallID: 'c4', Type: 'Incoming Call', caller: '0521111111', target: '039999999', Duration: 130 })
    expect('phones' in r && r.phones[0]).toBe('0521111111')
  })
})
