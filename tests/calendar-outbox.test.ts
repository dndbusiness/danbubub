import { describe, expect, it } from 'vitest'
import { calendarExpired, calendarKeyPrefix } from '@/lib/rules/calendar-events'

describe('outbox של היומן — לא מציפים את היומן כשגוגל מתחבר', () => {
  it('אירוע שתאריכו עבר לא נשלח; היום ועתיד כן', () => {
    expect(calendarExpired('2026-10-19', '2026-10-20')).toBe(true)
    expect(calendarExpired('2026-10-20', '2026-10-20')).toBe(false)
    expect(calendarExpired('2026-11-01', '2026-10-20')).toBe(false)
    expect(calendarExpired(undefined, '2026-10-20')).toBe(false)
  })
  it('כל הגרסאות של אירוע חולקות תחילית, ואירוע אחר לא נתפס בה', () => {
    const p = calendarKeyPrefix('vat:2026-10')
    expect(('cal:vat:2026-10:abc').startsWith(p)).toBe(true)
    expect(('cal:vat:2026-10-x:abc').startsWith(p)).toBe(false)
  })
})
