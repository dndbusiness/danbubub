import { describe, expect, it, vi } from 'vitest'
import { toGoogleEvent, upsertEvent } from '@/lib/google/calendar.js'

const ev = { ruleKey: 'month_close:2026-09', title: '[כספים] סגירת חודש', date: '2026-09-30', time: '10:00', durationMinutes: 30, description: 'x', attendees: ['dan@x'] }

describe('Google Calendar — ב.1/ב.2', () => {
  it('אירוע עם שעה → dateTime באזור ירושלים; יום שלם → date', () => {
    const g = toGoogleEvent(ev, 'fp') as { start: { dateTime: string; timeZone: string }; end: { dateTime: string }; extendedProperties: { private: { rule_key: string } } }
    expect(g.start).toEqual({ dateTime: '2026-09-30T10:00:00', timeZone: 'Asia/Jerusalem' })
    expect(g.end.dateTime).toBe('2026-09-30T10:30:00')
    expect(g.extendedProperties.private.rule_key).toBe('month_close:2026-09')
    const allDay = toGoogleEvent({ ...ev, time: undefined }, 'fp') as { start: { date: string }; end: { date: string } }
    expect(allDay.start).toEqual({ date: '2026-09-30' }); expect(allDay.end).toEqual({ date: '2026-10-01' })
  })
  it('upsert: לא קיים → POST; קיים עם אותו fingerprint → unchanged; שונה → PATCH', async () => {
    const calls: string[] = []
    const mk = (items: unknown[]) => (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url).split('?')[0]!.split('/events')[1] ?? ''}`)
      if (!init?.method) return new Response(JSON.stringify({ items }))
      return new Response(JSON.stringify({ id: 'new' }))
    }) as unknown as typeof fetch
    expect(await upsertEvent('t', 'primary', ev, 'fp1', mk([]))).toBe('created')
    expect(await upsertEvent('t', 'primary', ev, 'fp1', mk([{ id: 'e1', extendedProperties: { private: { fingerprint: 'fp1' } } }]))).toBe('unchanged')
    expect(await upsertEvent('t', 'primary', ev, 'fp2', mk([{ id: 'e1', extendedProperties: { private: { fingerprint: 'fp1' } } }]))).toBe('updated')
    expect(calls).toEqual(['GET ', 'POST ', 'GET ', 'GET ', 'PATCH /e1'])
  })
})
