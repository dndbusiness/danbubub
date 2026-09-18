import { describe, expect, it } from 'vitest'
import { eventFingerprint, isEmployeeMeeting, planCalendarEvents, type CalendarPlanInput } from '@/lib/rules/calendar-events.js'

const base: CalendarPlanInput = {
  asOf: '2026-09-18', baseUrl: 'https://h', people: { dan: 'dan@x', nissim: 'n@x', hadas: 'h@x' }, settings: {},
  closingBlockers: [{ month: '2026-09', items: ['7 תיקים בלי חודש'] }], transferDue: { month: '2026-09', amount: 12_000 }, expectedAdvance: 28_850,
  payrollDrafts: [{ month: '2026-09', names: ['יוני'] }], payrollTotals: [{ month: '2026-09', total: 40_000, lines: ['יוני 25,000', 'נדיה 15,000'] }],
  accountantChecklist: [{ month: '2026-09', items: [{ label: 'דפי בנק יובאו', done: false }] }], vatLiability: [{ month: '2026-09', amount: 5_000 }],
  cardCharges: [{ accountId: 'c1', name: 'ישראכרט 1234', billingDay: 10, expected: 8_000, details: ['תוכנות 2,000'] }],
  receipts: [{ planId: 'p1', date: '2026-09-25', client: 'כהן', amount: 45_000, nextMissing: 'שמאות' }, { planId: 'p2', date: '2027-01-01', client: 'רחוק', amount: 1 }],
  decayedDeals: [{ dealId: 'd1', client: 'לוי', daysStale: 31, ownerEmail: 'owner@x' }], anchorStale: { lastDate: '2026-09-15' },
}

describe('אירועי יומן — ADDENDUM ב.2', () => {
  const events = planCalendarEvents(base)
  const by = (k: string) => events.find((e) => e.ruleKey === k)

  it('כל כותרת מתחילה ב-[כספים] ויש rule_key ייחודי', () => {
    expect(events.every((e) => e.title.startsWith('[כספים]'))).toBe(true)
    expect(new Set(events.map((e) => e.ruleKey)).size).toBe(events.length)
  })
  it('סגירת חודש 30 ב-10:00 לדן + ניסים עם החריגים החיים', () => {
    const e = by('month_close:2026-09')!
    expect(e.date).toBe('2026-09-30'); expect(e.time).toBe('10:00'); expect(e.attendees).toEqual(['dan@x', 'n@x'])
    expect(e.description).toContain('7 תיקים בלי חודש')
  })
  it('העברת התחשבנות ב-10 לחודש הבא עם הסכום מהסגירה', () => {
    expect(by('settlement_transfer:2026-10')?.title).toContain('12,000')
  })
  it('שכר: אישור 27, תשלום 9 (על החודש הקודם); רו"ח 12 לדן + הדס; מע"מ 15', () => {
    expect(by('payroll_approve:2026-09')?.description).toContain('יוני')
    expect(by('payroll_pay:2026-10')?.title).toContain('40,000')
    expect(by('accountant_close:2026-09')?.attendees).toEqual(['dan@x', 'h@x'])
    expect(by('vat:2026-10')?.title).toContain('5,000')
  })
  it('חיוב אשראי לפי billing_day, תקבול committed בטווח בלבד, תיק נרקב לאחראי, עוגן', () => {
    expect(by('card_billing:c1:2026-10')?.date).toBe('2026-10-10')
    expect(by('receipt:p1')?.attendees).toContain('h@x')
    expect(by('receipt:p2')).toBeUndefined()
    expect(by('deal_decay:d1')?.attendees).toEqual(['owner@x'])
    expect(by('anchor_stale:2026-09-18')).toBeTruthy()
  })
  it('דוח שבועי בכל יום שישי בטווח', () => {
    const fridays = events.filter((e) => e.ruleKey.startsWith('weekly_report:'))
    expect(fridays.length).toBeGreaterThanOrEqual(8)
    expect(fridays.every((e) => new Date(`${e.date}T00:00:00Z`).getUTCDay() === 5)).toBe(true)
  })
  it('הגדרה undefined לא שוברת תאריכים (ברירת המחדל נשמרת)', () => {
    const ev = planCalendarEvents({ ...base, settings: { payrollPayDay: undefined, vatDay: NaN } })
    expect(ev.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true)
    expect(ev.find((e) => e.ruleKey === 'payroll_pay:2026-10')?.date).toBe('2026-10-09')
  })
  it('מע"מ דו-חודשי מדלג על חודשים זוגיים', () => {
    const ev = planCalendarEvents({ ...base, settings: { vatBimonthly: true } })
    expect(ev.find((e) => e.ruleKey === 'vat:2026-10')).toBeUndefined()
    expect(ev.find((e) => e.ruleKey === 'vat:2026-11')).toBeTruthy()
  })
  it('טביעת אצבע: אותו תוכן = אותה מחרוזת (לא מעדכנים סתם)', () => {
    expect(eventFingerprint(events[0]!)).toBe(eventFingerprint(planCalendarEvents(base)[0]!))
  })
  it('פגישה לשכר: כותרת עם "פגישה" + שם העובד', () => {
    expect(isEmployeeMeeting('פגישה עם לקוח — יוני', 'יוני')).toBe(true)
    expect(isEmployeeMeeting('יוני — ארוחת צהריים', 'יוני')).toBe(false)
  })
})
