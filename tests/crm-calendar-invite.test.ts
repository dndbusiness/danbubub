import { describe, expect, it } from 'vitest'
import { calendarTool } from '@/lib/crm/google-tools'

/** פגישה של השקעות: נכנסת ליומן של האנליסט (calendarId) והלקוח מקבל זימון (attendees + sendUpdates=all) */
describe('calendarTool — פגישה ביומן האנליסט עם זימון ללקוח', () => {
  const fake = () => {
    const calls: { url: string; body: Record<string, unknown> | null }[] = []
    const f = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
      return new Response(JSON.stringify({ id: 'e1', start: {}, end: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    return { calls, f }
  }
  it('יומן של האנליסט + משתתפים', async () => {
    const { calls, f } = fake()
    await calendarTool('create_event', { summary: 'זום — לקוח', startTime: '2026-10-20T11:00:00', endTime: '2026-10-20T11:45:00', calendarId: 'an@x.com', attendees: [{ email: 'client@example.com' }, { email: 'לא מייל' }] }, 't', f)
    const u = new URL(calls[0]!.url)
    expect(u.pathname).toBe('/calendar/v3/calendars/an%40x.com/events')
    expect(u.searchParams.get('sendUpdates')).toBe('all')
    expect(calls[0]!.body!.attendees).toEqual([{ email: 'client@example.com' }])
  })
  it('בלי יומן ובלי משתתפים — היומן הראשי, בלי זימונים', async () => {
    const { calls, f } = fake()
    await calendarTool('create_event', { summary: 'x', startTime: '2026-10-20T11:00:00' }, 't', f)
    const u = new URL(calls[0]!.url)
    expect(u.pathname).toBe('/calendar/v3/calendars/primary/events')
    expect(u.searchParams.get('sendUpdates')).toBeNull()
    expect(calls[0]!.body!.attendees).toBeUndefined()
  })
  it('אירועים תפוסים ביומן של האנליסט', async () => {
    const { calls, f } = fake()
    await calendarTool('list_events', { calendarId: 'an@x.com', startTime: '2026-10-20T00:00:00', endTime: '2026-10-20T23:59:00' }, 't', f)
    expect(new URL(calls[0]!.url).pathname).toBe('/calendar/v3/calendars/an%40x.com/events')
  })
})
