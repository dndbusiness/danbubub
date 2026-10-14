import { describe, expect, it, vi } from 'vitest'
import { calendarTool, driveQuery, driveTool, ilTime, ToolError } from '@/lib/crm/google-tools.js'

type Call = { url: string; init?: RequestInit }
const fake = (replies: unknown[]) => {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(replies.shift() ?? {}))
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('CRM על השרת — שאילתות דרייב כמו בחיבור של Claude', () => {
  it("parentId = '…' → '…' in parents, בלי קבצים בפח", () => {
    expect(driveQuery("parentId = 'abc_DEF-123'")).toBe("'abc_DEF-123' in parents and trashed = false")
    expect(driveQuery("parentId = 'p1' and title contains 'משכנתא'")).toBe("'p1' in parents and name contains 'משכנתא' and trashed = false")
  })
  it('שאילתה שלא הבנו לא עוברת לגוגל', () => {
    expect(() => driveQuery("parentId = 'x' or 1=1")).toThrow(ToolError)
    expect(() => driveQuery("title contains 'a\\' or name contains '")).toThrow(ToolError)
  })
})

describe('Drive — search_files / update_file', () => {
  it('search_files מחזיר את המבנה שהדף מצפה לו (title, viewUrl, nextPageToken)', async () => {
    const { calls, fetchImpl } = fake([{ nextPageToken: 'n2', files: [{ id: 'f1', name: 'ת״ז.pdf', mimeType: 'application/pdf', size: '120', webViewLink: 'https://d/f1', parents: ['p1'] }] }])
    const r = await driveTool('search_files', { query: "parentId = 'p1'", pageSize: 100, pageToken: 't1' }, 'tok', fetchImpl) as { files: Record<string, unknown>[]; nextPageToken?: string }
    expect(r.files[0]).toMatchObject({ id: 'f1', title: 'ת״ז.pdf', mimeType: 'application/pdf', fileSize: '120', viewUrl: 'https://d/f1', parentId: 'p1' })
    expect(r.nextPageToken).toBe('n2')
    const u = new URL(calls[0]!.url)
    expect(u.searchParams.get('q')).toBe("'p1' in parents and trashed = false")
    expect(u.searchParams.get('pageToken')).toBe('t1')
  })
  it('update_file עם parentId = העברה: מוסיף את החדשה ומסיר את הקודמת', async () => {
    const { calls, fetchImpl } = fake([{ parents: ['old'] }, { id: 'f1', name: 'x', mimeType: 'application/pdf', parents: ['new'] }])
    const r = await driveTool('update_file', { fileId: 'f1', parentId: 'new' }, 'tok', fetchImpl) as Record<string, unknown>
    expect(r).toMatchObject({ id: 'f1', parentId: 'new' })
    const u = new URL(calls[1]!.url)
    expect(calls[1]!.init?.method).toBe('PATCH')
    expect(u.searchParams.get('addParents')).toBe('new')
    expect(u.searchParams.get('removeParents')).toBe('old')
  })
})

describe('יומן — שעון ישראל', () => {
  it('קיץ +03:00, חורף +02:00, ומחרוזת עם היסט עוברת כמו שהיא', () => {
    expect(ilTime('2026-07-01T09:00:00')).toBe('2026-07-01T09:00:00+03:00')
    expect(ilTime('2026-12-01T09:00')).toBe('2026-12-01T09:00:00+02:00')
    expect(ilTime('2026-12-01')).toBe('2026-12-01T00:00:00+02:00')
    expect(ilTime('2026-12-01T09:00:00Z')).toBe('2026-12-01T09:00:00Z')
  })
  it('list_events → { events } עם start/htmlLink, בטווח היום', async () => {
    const { calls, fetchImpl } = fake([{ items: [{ id: 'e1', summary: 'פגישה עם אריאל', start: { dateTime: '2026-10-14T10:00:00+03:00' }, htmlLink: 'https://cal/e1' }] }])
    const r = await calendarTool('list_events', { startTime: '2026-10-14T00:00:00', endTime: '2026-10-15T00:00:00', orderBy: 'startTime', pageSize: 50 }, 'tok', fetchImpl) as { events: Record<string, unknown>[] }
    expect(r.events[0]).toMatchObject({ id: 'e1', summary: 'פגישה עם אריאל', htmlLink: 'https://cal/e1', status: 'confirmed' })
    const u = new URL(calls[0]!.url)
    expect(u.searchParams.get('timeMin')).toBe('2026-10-14T00:00:00+03:00')
    expect(u.searchParams.get('singleEvents')).toBe('true')
  })
  it('search_events מעביר את השם כ-q', async () => {
    const { calls, fetchImpl } = fake([{ items: [] }])
    await calendarTool('search_events', { query: 'אריאל ביקמן', pageSize: 20 }, 'tok', fetchImpl)
    expect(new URL(calls[0]!.url).searchParams.get('q')).toBe('אריאל ביקמן')
  })
  it('create_event: POST עם אזור זמן ישראל, מחזיר id ו-htmlLink', async () => {
    const { calls, fetchImpl } = fake([{ id: 'e9', htmlLink: 'https://cal/e9', summary: 'זום' }])
    const r = await calendarTool('create_event', { summary: 'זום', startTime: '2026-10-20T11:00:00', endTime: '2026-10-20T11:45:00', description: 'd' }, 'tok', fetchImpl) as Record<string, unknown>
    expect(r).toMatchObject({ id: 'e9', htmlLink: 'https://cal/e9' })
    const body = JSON.parse(String(calls[0]!.init?.body))
    expect(body.start).toEqual({ dateTime: '2026-10-20T11:00:00', timeZone: 'Asia/Jerusalem' })
    expect(calls[0]!.init?.method).toBe('POST')
  })
  it('כלי שלא קיים — tool_not_found', async () => {
    await expect(calendarTool('delete_event', {}, 'tok', fake([]).fetchImpl)).rejects.toMatchObject({ code: 'tool_not_found' })
  })
})
