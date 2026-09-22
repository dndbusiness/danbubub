/**
 * Google Calendar — ADDENDUM ב.1 "יומנים" + ב.2. scope calendar.events.
 * זיהוי אירוע לפי extendedProperties.private.rule_key → עדכון במקום כפילות.
 * מחיקה ידנית ביומן לא משפיעה על המערכת (לא יוצרים מחדש אירוע שנמחק? — כן יוצרים: ב.1 אומר רק שהמערכת לא מושפעת).
 */
import type { CalendarEvent } from '@/lib/rules/calendar-events'

const TZ = 'Asia/Jerusalem'

export interface GEvent { id: string; summary?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; description?: string; attendees?: { email: string }[]; extendedProperties?: { private?: Record<string, string> } }

async function api(token: string, url: string, init: RequestInit, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : (res.json() as Promise<Record<string, unknown>>)
}

const base = (calendarId: string) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`

/** גוף האירוע ל-API מתוך האירוע הטהור. */
export function toGoogleEvent(e: CalendarEvent, fingerprint: string): Record<string, unknown> {
  const start = e.time ? { dateTime: `${e.date}T${e.time}:00`, timeZone: TZ } : { date: e.date }
  let end: Record<string, string>
  if (e.time) {
    const [h, m] = e.time.split(':').map(Number)
    const total = h! * 60 + m! + (e.durationMinutes ?? 30)
    end = { dateTime: `${e.date}T${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`, timeZone: TZ }
  } else {
    const d = new Date(`${e.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)
    end = { date: d.toISOString().slice(0, 10) }
  }
  return {
    summary: e.title, description: e.description + (e.link ? `\n${e.link}` : ''), start, end,
    attendees: e.attendees.map((email) => ({ email })),
    extendedProperties: { private: { rule_key: e.ruleKey, fingerprint, source: 'harel-finance' } },
    reminders: { useDefault: true },
  }
}

export async function findByRuleKey(token: string, calendarId: string, ruleKey: string, fetchImpl: typeof fetch = fetch): Promise<GEvent | null> {
  const u = new URL(base(calendarId))
  u.searchParams.set('privateExtendedProperty', `rule_key=${ruleKey}`)
  u.searchParams.set('showDeleted', 'false'); u.searchParams.set('maxResults', '1'); u.searchParams.set('singleEvents', 'true')
  const data = (await api(token, u.toString(), {}, fetchImpl)) as { items?: GEvent[] } | null
  return data?.items?.[0] ?? null
}

/** יצירה או עדכון לפי rule_key; מדלג אם ה-fingerprint זהה. */
export async function upsertEvent(token: string, calendarId: string, e: CalendarEvent, fingerprint: string, fetchImpl: typeof fetch = fetch): Promise<'created' | 'updated' | 'unchanged'> {
  const existing = await findByRuleKey(token, calendarId, e.ruleKey, fetchImpl)
  const body = JSON.stringify(toGoogleEvent(e, fingerprint))
  if (!existing) { await api(token, `${base(calendarId)}?sendUpdates=none`, { method: 'POST', body }, fetchImpl); return 'created' }
  if (existing.extendedProperties?.private?.fingerprint === fingerprint) return 'unchanged'
  await api(token, `${base(calendarId)}/${existing.id}?sendUpdates=none`, { method: 'PATCH', body }, fetchImpl)
  return 'updated'
}

/** ב.2 "קריאה מהיומן" — אירועים בטווח (לספירת פגישות לשכר, 3.9). */
export async function listEvents(token: string, calendarId: string, from: string, to: string, fetchImpl: typeof fetch = fetch): Promise<GEvent[]> {
  const u = new URL(base(calendarId))
  u.searchParams.set('timeMin', `${from}T00:00:00Z`); u.searchParams.set('timeMax', `${to}T23:59:59Z`)
  u.searchParams.set('singleEvents', 'true'); u.searchParams.set('maxResults', '2500'); u.searchParams.set('orderBy', 'startTime')
  const data = (await api(token, u.toString(), {}, fetchImpl)) as { items?: GEvent[] } | null
  return data?.items ?? []
}
