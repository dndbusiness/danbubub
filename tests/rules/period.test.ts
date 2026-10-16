import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  dayInMonth,
  daysBetween,
  inRange,
  isPeriodLocked,
  monthOf,
  monthRange,
  monthsBetween,
  weekStart,
} from '@/lib/rules/period.js'

describe('תקופות ותאריכים', () => {
  it('טווח חודש כולל את היום האחרון', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2028-02').to).toBe('2028-02-29') // שנה מעוברת
  })

  it('הזזת חודשים חוצה שנה', () => {
    expect(addMonths('2026-09', -2)).toBe('2026-07')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })

  it('רשימת חודשים רצופה', () => {
    expect(monthsBetween('2026-07', '2026-09')).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(monthsBetween('2026-09', '2026-07')).toEqual([])
  })

  it('הוצאה קבועה ליום 30 לא נעלמת בפברואר', () => {
    expect(dayInMonth('2026-02', 30)).toBe('2026-02-28')
    expect(dayInMonth('2026-09', 9)).toBe('2026-09-09')
  })

  it('תחילת שבוע היא יום ראשון', () => {
    expect(weekStart('2026-09-16')).toBe('2026-09-13') // רביעי → ראשון שלפניו
    expect(weekStart('2026-09-13')).toBe('2026-09-13')
  })

  it('חישובי ימים', () => {
    expect(daysBetween('2026-07-01', '2026-09-01')).toBe(62)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('inRange כולל את שני הקצוות', () => {
    const r = { from: '2026-09-01', to: '2026-09-30' }
    expect(inRange('2026-09-01', r)).toBe(true)
    expect(inRange('2026-09-30', r)).toBe(true)
    expect(inRange('2026-10-01', r)).toBe(false)
  })

  it('monthOf', () => {
    expect(monthOf('2026-09-22')).toBe('2026-09')
  })

  it('תאריך לא חוקי נופל', () => {
    expect(() => monthOf('22/09/2026')).toThrow()
    expect(() => monthRange('2026-9')).toThrow()
  })

  it('תקופה נעולה מזוהה לפי פעילות (SPEC §1.6)', () => {
    const periods = [
      { year: 2026, month: 7, division: 'finance', status: 'closed' },
      { year: 2026, month: 7, division: 'realestate', status: 'open' },
    ]
    expect(isPeriodLocked('2026-07', 'finance', periods)).toBe(true)
    expect(isPeriodLocked('2026-07', 'realestate', periods)).toBe(false)
    expect(isPeriodLocked('2026-08', 'finance', periods)).toBe(false)
  })
})
