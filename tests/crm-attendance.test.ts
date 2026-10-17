import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ATT, attAlertText, attContacts, attManagerOf, attNotifyCheck, attOutboxRows, attPhone, attRuleKey, attStep, attTz, attUpsertGap, attWatchPlan,
  type AttDoc, type AttSettings, type AttUser,
} from '@/lib/crm/attendance'

/** שעון הנוכחות (דן, 17/10/26) — הכללים בשרת, ואותם כללים בדף (crm/harel-crm.html) */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a0 = html.indexOf('/* ══ נוכחות — כללים טהורים'), b0 = html.indexOf('/* ══ סוף כללי נוכחות ══ */')
const PAGE = new Function(html.slice(a0, b0) + '; return { ATT, attTz, attRuleKey, attManagerOf, attUpsertGap, attOutPatch, attStep, attAlertText };')() as {
  ATT: typeof ATT; attTz: typeof attTz; attRuleKey: typeof attRuleKey; attManagerOf: typeof attManagerOf; attUpsertGap: typeof attUpsertGap
  attStep: typeof attStep; attAlertText: typeof attAlertText
}

/** המשתמשים האמיתיים (בלי סיסמאות): הדס, ניסים, אביב, עדן, ישי, מיכל */
const USERS: AttUser[] = [
  { username: 'hadas', resp: 'hadas', role: 'admin', label: 'הדס' },
  { username: 'zoos', resp: 'nissim', role: 'partner', label: 'ניסים' },
  { username: 'aviv', resp: 'aviv', role: 'admin_re', label: 'אביב' },
  { username: 'eden', resp: 'eden', role: 'center', label: 'עדן', divs: ['finance', 'realestate'] },
  { username: 'ishai', resp: 'ishai', role: 'center', label: 'ישי', divs: ['realestate'] },
  { username: 'michal', resp: 'michal', role: 'center', label: 'מיכל', divs: ['realestate'] },
]
const D = '2026-10-17'
const T = (hm: string) => Date.parse(`${D}T${hm}:00+03:00`) // שעון ישראל (קיץ)
const iso = (hm: string) => new Date(T(hm)).toISOString()
const shift = (over: Partial<AttDoc> = {}): AttDoc => ({ id: 'eden_' + D, key: 'eden', label: 'עדן', date: D, in: { at: iso('09:00'), place: 'office' }, lastActive: iso('09:00'), gaps: [], ...over })

describe('ניתוב ההתראות', () => {
  it('הדס ופתרונות → דן; מוקד ונדל"ן → אביב; אביב → דן; דן → אף אחד', () => {
    const m = Object.fromEntries(['dan', 'hadas', 'nissim', 'aviv', 'eden', 'ishai', 'michal'].map((k) => [k, attManagerOf(k, USERS)]))
    expect(m).toEqual({ dan: null, hadas: 'dan', nissim: 'dan', aviv: 'dan', eden: 'aviv', ishai: 'aviv', michal: 'aviv' })
  })
  it('עובדים עתידיים: פתרונות → דן, השקעות → אביב; מוקד רק בפתרונות → דן; לא מוכר → דן', () => {
    const us: AttUser[] = [...USERS, { username: 'new1', role: 'center', divs: ['finance'] }, { username: 'new2', role: 'center', divs: ['realestate'] }, { username: 'new3', role: 'admin_re' }, { username: 'new4', role: 'partner' }]
    expect(['new1', 'new2', 'new3', 'new4', 'ghost'].map((k) => attManagerOf(k, us))).toEqual(['dan', 'aviv', 'aviv', 'dan', 'dan'])
  })
  it('users[].manager גובר (ולא על עצמו)', () => {
    const us = USERS.map((u) => (u.resp === 'eden' ? { ...u, manager: 'hadas' } : u.resp === 'aviv' ? { ...u, manager: 'aviv' } : u))
    expect(attManagerOf('eden', us)).toBe('hadas')
    expect(attManagerOf('aviv', us)).toBe('dan')
  })
})

describe('rule_key ונוסח', () => {
  it('מפתח אחד לכל יציאה מהטווח ולכל פער', () => {
    expect(attRuleKey('away', 'eden', D, iso('10:00'))).toBe('att_away:eden:2026-10-17:2026-10-17T07:00:00.000Z')
    expect(attRuleKey('idle', 'eden', D, iso('09:00'))).toBe('att_idle:eden:2026-10-17:2026-10-17T06:00:00.000Z')
  })
  it('השעה בהודעה בשעון ישראל', () => {
    expect(attTz(T('23:30'))).toEqual({ date: D, hour: 23, hm: '23:30' })
    expect(attAlertText('away', 'עדן', iso('10:07'))).toBe('עדן יצא/ה מטווח המשרד ב-10:07 — לאשר עבודה מהבית?')
    expect(attAlertText('idle', 'עדן', iso('09:00'), 64)).toBe('עדן בלי פעילות במערכת 64 דקות (מאז 09:00) — השעון ממשיך לרוץ')
  })
})

describe('יציאה מהטווח → אישור → יציאה אוטומטית', () => {
  it('נראה מחוץ לטווח בפעם הראשונה: awayAt + בקשת אישור + התראה', () => {
    const r = attStep(shift({ lastActive: iso('10:00') }), { now: T('10:05'), inRange: false })
    expect(r.patch).toMatchObject({ awayAt: iso('10:05'), home: { status: 'pending', reason: 'away' } })
    expect(r.notify).toEqual([{ kind: 'away', ruleKey: attRuleKey('away', 'eden', D, iso('10:05')), at: iso('10:05') }])
    expect(r.logout).toBe(false)
  })
  it('עדיין בחוץ אחרי 14 דקות — כלום (ההתראה כבר נשלחה)', () => {
    const k = attRuleKey('away', 'eden', D, iso('10:05'))
    const a = shift({ lastActive: iso('10:10'), awayAt: iso('10:05'), home: { status: 'pending', reason: 'away' }, notified: [k] })
    expect(attStep(a, { now: T('10:19'), inRange: false })).toMatchObject({ patch: null, notify: [], logout: false })
  })
  it('15 דקות בלי אישור → יציאה בשעת היציאה מהטווח, אוטומטית, וניתוק', () => {
    const a = shift({ lastActive: iso('10:10'), awayAt: iso('10:05'), home: { status: 'pending', reason: 'away' } })
    const r = attStep(a, { now: T('10:20') })
    expect(r.logout).toBe(true)
    expect(r.patch).toMatchObject({ out: { at: iso('10:05'), place: 'away', auto: true, reason: 'away', autoAt: iso('10:20') }, home: { status: 'expired' } })
  })
  it('המנהל דחה → יציאה מיד, בשעת היציאה מהטווח', () => {
    const a = shift({ awayAt: iso('10:05'), home: { status: 'rejected', reason: 'away' }, lastActive: iso('10:06') })
    expect(attStep(a, { now: T('10:08') }).patch).toMatchObject({ out: { at: iso('10:05'), reason: 'rejected', auto: true } })
  })
  it('אושר → המשמרת ממשיכה, גם מחוץ לטווח ואחרי 15 דקות', () => {
    const a = shift({ awayAt: iso('10:05'), home: { status: 'approved', reason: 'away' }, lastActive: iso('10:30') })
    expect(attStep(a, { now: T('10:40'), inRange: false })).toMatchObject({ patch: null, notify: [], logout: false })
  })
  it('חזר לטווח לפני 15 דקות → awayAt מתאפס ונשארת הערה', () => {
    const a = shift({ awayAt: iso('10:05'), home: { status: 'pending', reason: 'away' }, lastActive: iso('10:10') })
    const r = attStep(a, { now: T('10:12'), inRange: true })
    expect(r.patch).toEqual({ awayAt: null, aways: [{ from: iso('10:05'), back: iso('10:12') }], home: { status: 'back', reason: 'away', at: iso('10:12') } })
    expect(r.logout).toBe(false)
  })
  it('מחשב משרד — אין בדיקת טווח בכלל', () => {
    const a = shift({ in: { at: iso('09:00'), place: 'office', device: 'dev1' }, lastActive: iso('10:00') })
    expect(attStep(a, { now: T('10:05'), inRange: false }).patch).toBeNull()
  })
  it('בלי בדיקת מיקום (השרת / אין מיקום) — לא מסמנים יציאה', () => {
    expect(attStep(shift({ lastActive: iso('10:00') }), { now: T('10:05'), inRange: null }).patch).toBeNull()
  })
  it('משמרת סגורה / מחוקה — כלום', () => {
    expect(attStep(shift({ out: { at: iso('12:00') } }), { now: T('14:00'), inRange: false }).patch).toBeNull()
    expect(attStep(shift({ deletedAt: iso('12:00') }), { now: T('14:00'), inRange: false }).patch).toBeNull()
  })
})

describe('שעה בלי פעילות', () => {
  it('59 דקות — כלום; 60 — התראה אחת, הפער נרשם פתוח, והשעון ממשיך', () => {
    const a = shift({ lastActive: iso('10:00') })
    expect(attStep(a, { now: T('10:59') }).notify).toEqual([])
    const r = attStep(a, { now: T('11:00') })
    expect(r.notify).toEqual([{ kind: 'idle', ruleKey: attRuleKey('idle', 'eden', D, iso('10:00')), at: iso('10:00'), min: 60 }])
    expect(r.patch).toEqual({ gaps: [{ from: iso('10:00'), to: iso('11:00'), min: 60, open: true }] })
    expect(r.patch!.out).toBeUndefined()
  })
  it('פעם אחת לכל פער: אותו פער שכבר דווח — כלום', () => {
    const a = shift({ lastActive: iso('10:00'), notified: [attRuleKey('idle', 'eden', D, iso('10:00'))] })
    expect(attStep(a, { now: T('11:30') })).toMatchObject({ patch: null, notify: [] })
  })
  it('פעילות בדפדפן שעוד לא נכתבה (activeAt) — לא מתריעים', () => {
    expect(attStep(shift({ lastActive: iso('10:00') }), { now: T('11:01'), activeAt: T('10:58') }).notify).toEqual([])
  })
  it('הפער נסגר כשחוזרים — אותה רשומה (לפי תחילת הפער), לא כפולה', () => {
    const open = attUpsertGap([], iso('10:00'), iso('11:00'), true)
    expect(attUpsertGap(open, iso('10:00'), iso('11:20'))).toEqual([{ from: iso('10:00'), to: iso('11:20'), min: 80 }])
  })
  it('השרת מאשר התראת פעילות רק כשהמסמך מראה שעה ומעלה', () => {
    expect(attNotifyCheck(shift({ lastActive: iso('10:00') }), 'idle', T('10:30'))).toBeNull()
    expect(attNotifyCheck(shift({ lastActive: iso('10:00') }), 'idle', T('11:05'))?.ruleKey).toBe(attRuleKey('idle', 'eden', D, iso('10:00')))
    expect(attNotifyCheck(shift(), 'away', T('11:05'))).toBeNull()
    expect(attNotifyCheck(shift({ awayAt: iso('10:05') }), 'away', T('10:06'))?.ruleKey).toBe(attRuleKey('away', 'eden', D, iso('10:05')))
    expect(attNotifyCheck(shift({ awayAt: iso('10:05'), home: { status: 'approved' } }), 'away', T('10:06'))).toBeNull()
  })
})

describe('סוף היום', () => {
  it('23:00 שעון ישראל — נסגר בפעילות האחרונה; יום קודם — גם', () => {
    const a = shift({ lastActive: iso('18:40') })
    expect(attStep(a, { now: T('22:59') }).patch?.out).toBeUndefined()
    expect(attStep(a, { now: T('23:00') })).toMatchObject({ why: 'eod', logout: false, patch: { out: { at: iso('18:40'), auto: true, reason: 'eod', place: 'office' } } })
    expect(attStep({ ...a, date: '2026-10-16' }, { now: T('08:00') }).why).toBe('eod')
  })
})

describe('הג׳וב attendance_watch', () => {
  const S: AttSettings = { users: USERS, notifyPhones: { dan: '050-1111111', aviv: '052-2222222' }, notifyEmails: { aviv: 'aviv@example.com' }, ownerEmail: 'dan@example.com' }
  it('טלפון ומייל של המנהל', () => {
    expect(attPhone('050-1234567')).toBe('972501234567')
    expect(attPhone('+972 50 123 4567')).toBe('972501234567')
    expect(attPhone('123')).toBe('')
    expect(attContacts('dan', S)).toEqual({ whatsapp: '972501111111', email: 'dan@example.com' })
    expect(attContacts('aviv', { users: USERS })).toEqual({ whatsapp: null, email: null })
  })
  it('שורות outbox: וואטסאפ + מייל, dedup_key = rule_key + ערוץ', () => {
    const n = attStep(shift({ lastActive: iso('10:00') }), { now: T('11:00') }).notify[0]!
    const { manager, rows } = attOutboxRows(n, shift(), S, 'https://x.example')
    expect(manager).toBe('aviv')
    expect(rows.map((r) => [r.channel, r.target, r.dedupKey])).toEqual([['whatsapp', '972522222222', n.ruleKey + ':whatsapp'], ['email', 'aviv@example.com', n.ruleKey + ':email']])
    expect(rows[0]!.body).toContain('עדן בלי פעילות במערכת 60 דקות')
    expect(rows[0]!.body).toContain('https://x.example/crm#day')
  })
  it('דן לא מקבל התראה על עצמו', () => {
    const n = attStep(shift({ key: 'dan', lastActive: iso('10:00') }), { now: T('11:00') }).notify[0]!
    expect(attOutboxRows(n, shift({ key: 'dan' }), S).rows).toEqual([])
  })
  it('החלטות: יציאה שלא אושרה, שעה בלי פעילות, סוף יום, ומשמרת תקינה — בלי כלום', () => {
    const docs = [
      { id: 'eden_' + D, data: shift({ awayAt: iso('10:05'), home: { status: 'pending', reason: 'away' }, lastActive: iso('10:10') }) },
      { id: 'hadas_' + D, data: shift({ key: 'hadas', label: 'הדס', lastActive: iso('09:10') }) },
      { id: 'ishai_2026-10-16', data: shift({ key: 'ishai', label: 'ישי', date: '2026-10-16', in: { at: '2026-10-16T06:00:00.000Z', place: 'office' }, lastActive: '2026-10-16T15:00:00.000Z' }) },
      { id: 'michal_' + D, data: shift({ key: 'michal', label: 'מיכל', lastActive: iso('10:15') }) },
    ]
    const plan = attWatchPlan(docs, S, T('10:30'))
    expect(plan.map((p) => [p.id, p.why])).toEqual([['eden_' + D, 'away'], ['hadas_' + D, 'idle'], ['ishai_2026-10-16', 'eod']])
    expect(plan[0]!.patch).toMatchObject({ out: { at: iso('10:05'), auto: true } })
    expect(plan[1]!.rows.map((r) => r.target)).toEqual(['972501111111', 'dan@example.com'])
    expect(plan[1]!.patch!.notified).toEqual([attRuleKey('idle', 'hadas', D, iso('09:10'))])
    expect(plan[2]!.patch).toMatchObject({ out: { at: '2026-10-16T15:00:00.000Z', reason: 'eod' } })
  })
  it('הדף והג׳וב מייצרים את אותו rule_key לאותו פער', () => {
    const a = shift({ lastActive: iso('10:00') })
    const job = attWatchPlan([{ id: a.id!, data: a }], S, T('11:10'))[0]!.notify[0]!.ruleKey
    expect(PAGE.attStep(a, { now: T('11:02') }).notify[0]!.ruleKey).toBe(job)
  })
})

describe('אותם כללים בדף ובשרת', () => {
  it('הבלוק קיים בדף', () => { expect(a0).toBeGreaterThan(0); expect(b0).toBeGreaterThan(a0) })
  it('קבועים, ניתוב, מפתחות ונוסח', () => {
    expect(PAGE.ATT).toEqual(ATT)
    const us: AttUser[] = [...USERS, { username: 'x', role: 'center', divs: ['finance'] }, { username: 'y', resp: 'eden', manager: 'hadas' }]
    for (const k of ['dan', 'hadas', 'nissim', 'aviv', 'eden', 'ishai', 'michal', 'x', 'ghost', null]) expect(PAGE.attManagerOf(k, USERS)).toBe(attManagerOf(k, USERS))
    for (const k of ['eden', 'x']) expect(PAGE.attManagerOf(k, us)).toBe(attManagerOf(k, us))
    expect(PAGE.attTz(T('23:59'))).toEqual(attTz(T('23:59')))
    expect(PAGE.attAlertText('away', 'Tesla בע״מ', iso('10:07'))).toBe(attAlertText('away', 'Tesla בע״מ', iso('10:07')))
    expect(PAGE.attAlertText('idle', 'עדן', iso('10:07'), 75)).toBe(attAlertText('idle', 'עדן', iso('10:07'), 75))
  })
  it('אותו צעד בכל המצבים', () => {
    const k = attRuleKey('away', 'eden', D, iso('10:05'))
    const docs: AttDoc[] = [
      shift({ lastActive: iso('10:00') }),
      shift({ lastActive: iso('08:00') }),
      shift({ awayAt: iso('10:05'), home: { status: 'pending', reason: 'away' }, lastActive: iso('10:10') }),
      shift({ awayAt: iso('10:05'), home: { status: 'pending', reason: 'away' }, lastActive: iso('10:10'), notified: [k] }),
      shift({ awayAt: iso('10:05'), home: { status: 'rejected', reason: 'away' } }),
      shift({ awayAt: iso('10:05'), home: { status: 'approved' } }),
      shift({ in: { at: iso('09:00'), place: 'office', device: 'd1' } }),
      shift({ date: '2026-10-16' }),
      shift({ out: { at: iso('12:00') } }),
      shift({ in: { at: iso('09:00'), place: 'home' }, home: { status: 'pending', note: '' } }),
    ]
    for (const a of docs) for (const now of [T('10:06'), T('10:12'), T('10:25'), T('11:30'), T('23:10')]) for (const inRange of [true, false, null]) for (const activeAt of [0, T('10:00')]) {
      expect(PAGE.attStep(a, { now, inRange, activeAt })).toEqual(attStep(a, { now, inRange, activeAt }))
    }
  })
})
