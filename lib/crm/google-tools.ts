/**
 * הכלים שהדף של ה-CRM קורא להם דרך "חיבורים" של Claude (Gmail / Google Drive / Google Calendar),
 * כאן מול גוגל ישירות עם ה-OAuth של השרת. אותם שמות כלים, אותו מבנה תשובה —
 * כדי שהדף ירוץ על השרת בלי שינוי. fetch ניתן להזרקה לבדיקות.
 */
import { base64url, buildMime } from '@/lib/google/gmail'

type F = typeof fetch
export type ToolInput = Record<string, unknown>

export class ToolError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

async function g(token: string, url: string | URL, init: RequestInit = {}, fetchImpl: F = fetch): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    throw new ToolError(res.status === 401 || res.status === 403 ? 'not_granted' : 'tool_error', `Google ${res.status}: ${text}`)
  }
  return res.status === 204 ? {} : (res.json() as Promise<Record<string, unknown>>)
}

const GM = 'https://gmail.googleapis.com/gmail/v1/users/me'

interface Header { name: string; value: string }
interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: Header[] }
interface GMsg { id: string; threadId: string; snippet?: string; internalDate?: string; payload?: Part }

const hdr = (m: GMsg, n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? ''
const addrList = (v: string) => v.split(',').map((s) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim()).filter(Boolean)
const senderOf = (v: string) => (v.match(/<([^>]+)>/)?.[1] ?? v).trim()
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

/** גוף טקסט: text/plain אם יש, אחרת HTML בלי תגיות. */
export function plainBody(p: Part | undefined): string {
  if (!p) return ''
  const find = (x: Part, type: string): string | null => {
    if (x.mimeType === type && x.body?.data) return fromB64url(x.body.data)
    for (const c of x.parts ?? []) { const r = find(c, type); if (r != null) return r }
    return null
  }
  const t = find(p, 'text/plain')
  if (t != null) return t
  const h = find(p, 'text/html')
  return h ? h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : ''
}

function msgView(m: GMsg, account: string | null) {
  return {
    id: m.id, threadId: m.threadId, subject: hdr(m, 'subject'), sender: senderOf(hdr(m, 'from')),
    toRecipients: addrList(hdr(m, 'to')), ccRecipients: addrList(hdr(m, 'cc')),
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : '', snippet: m.snippet ?? '',
    viewUrl: viewUrl(m.threadId, account),
  }
}

/** הקבצים המצורפים בהודעה (שם, סוג, גודל) — בלי התוכן; התוכן דרך get_message RAW. */
function attachmentsOf(p: Part | undefined, out: { filename: string; mimeType: string; size: number; attachmentId: string | null }[] = []) {
  if (!p) return out
  const b = p.body as { attachmentId?: string; size?: number } | undefined
  const filename = (p as { filename?: string }).filename
  if (filename) out.push({ filename, mimeType: p.mimeType ?? 'application/octet-stream', size: Number(b?.size ?? 0), attachmentId: b?.attachmentId ?? null })
  for (const c of p.parts ?? []) attachmentsOf(c, out)
  return out
}

const viewUrl = (threadId: string, account: string | null) => `https://mail.google.com/mail/${account ? `?authuser=${encodeURIComponent(account)}` : ''}#all/${threadId}`

export async function gmailTool(tool: string, input: ToolInput, token: string, account: string | null, fetchImpl: F = fetch): Promise<unknown> {
  switch (tool) {
    case 'send_message': {
      const to = (input.to as string[] | undefined) ?? []
      if (!to.length) throw new ToolError('invalid_argument', 'אין נמען')
      const atts = ((input.attachments as { filename: string; mimeType: string; content: string }[] | undefined) ?? [])
        .map((a) => ({ fileName: a.filename, mimeType: a.mimeType, content: Buffer.from(a.content, 'base64') }))
      // עותק (cc) — למשל finance@ בהגשה לגוף. בלעדיו העותק לא היה יוצא בשרת.
      const cc = ((input.cc as string[] | undefined) ?? []).map((x) => String(x).trim()).filter((x) => /^[^@\s,;]+@[^@\s,;]+$/.test(x))
      const raw = base64url(buildMime({ to, ...(cc.length ? { cc } : {}), subject: String(input.subject ?? ''), html: String(input.htmlBody ?? input.body ?? ''), attachments: atts }))
      const r = await g(token, `${GM}/messages/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }) }, fetchImpl)
      return { id: r.id }
    }
    case 'list_labels': {
      const r = await g(token, `${GM}/labels`, {}, fetchImpl) as { labels?: { id: string; name: string; type?: string }[] }
      return { labels: (r.labels ?? []).map((l) => ({ labelId: l.id, name: l.name, type: l.type })) }
    }
    case 'create_label': {
      const r = await g(token, `${GM}/labels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: input.displayName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) }, fetchImpl)
      return { labelId: r.id, name: r.name }
    }
    case 'label_thread': {
      await g(token, `${GM}/threads/${encodeURIComponent(String(input.threadId))}/modify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ addLabelIds: input.labelIds ?? [] }) }, fetchImpl)
      return {}
    }
    case 'search_threads': {
      const u = new URL(`${GM}/threads`)
      if (input.query) u.searchParams.set('q', String(input.query))
      u.searchParams.set('maxResults', String(Math.min(50, Number(input.pageSize) || 20)))
      const list = await g(token, u, {}, fetchImpl) as { threads?: { id: string }[] }
      const threads = await Promise.all((list.threads ?? []).map(async (t) => {
        const m = new URL(`${GM}/threads/${t.id}`); m.searchParams.set('format', 'metadata')
        for (const h of ['From', 'To', 'Cc', 'Subject', 'Date']) m.searchParams.append('metadataHeaders', h)
        const th = await g(token, m, {}, fetchImpl) as { id: string; messages?: GMsg[] }
        return { id: th.id, viewUrl: viewUrl(th.id, account), messages: (th.messages ?? []).slice(0, 5).map((x) => msgView(x, account)) }
      }))
      return { threads }
    }
    case 'get_thread': {
      const th = await g(token, `${GM}/threads/${encodeURIComponent(String(input.threadId))}?format=full`, {}, fetchImpl) as { id: string; messages?: GMsg[] }
      return { id: th.id, messages: (th.messages ?? []).map((x) => ({ ...msgView(x, account), plaintextBody: plainBody(x.payload), attachments: attachmentsOf(x.payload) })) }
    }
    case 'get_message': {
      // RAW — הדף מפרק את ה-MIME בעצמו ושומר את הקבצים בדרייב של הלקוח (mailFilesToDrive)
      const id = encodeURIComponent(String(input.messageId ?? ''))
      if (!id) throw new ToolError('invalid_argument', 'Gmail: חסר messageId')
      const raw = String(input.messageFormat ?? '').toUpperCase() === 'RAW'
      const m = await g(token, `${GM}/messages/${id}?format=${raw ? 'raw' : 'full'}`, {}, fetchImpl) as unknown as GMsg & { raw?: string }
      return raw ? { id: m.id, threadId: m.threadId, raw: m.raw ?? '' } : { ...msgView(m, account), plaintextBody: plainBody(m.payload), attachments: attachmentsOf(m.payload) }
    }
    default: throw new ToolError('tool_not_found', `Gmail: הכלי ${tool} לא ממומש בשרת`)
  }
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files'
const FOLDER = 'application/vnd.google-apps.folder'

export async function driveTool(tool: string, input: ToolInput, token: string, fetchImpl: F = fetch): Promise<unknown> {
  switch (tool) {
    case 'create_file': {
      const meta: Record<string, unknown> = { name: String(input.title ?? 'ללא שם') }
      if (input.parentId) meta.parents = [input.parentId]
      if (input.mimeType === FOLDER) {
        meta.mimeType = FOLDER
        const r = await g(token, `${DRIVE}?fields=id,webViewLink,name&supportsAllDrives=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta) }, fetchImpl)
        return { id: r.id, viewUrl: r.webViewLink, title: r.name }
      }
      const content = input.base64Content ? Buffer.from(String(input.base64Content), 'base64') : Buffer.from(String(input.textContent ?? ''), 'utf8')
      const ctype = String(input.contentMimeType ?? 'application/octet-stream')
      const boundary = 'harel' + Math.random().toString(36).slice(2)
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${ctype}\r\n\r\n`),
        content, Buffer.from(`\r\n--${boundary}--`),
      ])
      const r = await g(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name,size&supportsAllDrives=true',
        { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body }, fetchImpl)
      return { id: r.id, viewUrl: r.webViewLink, title: r.name, fileSize: r.size }
    }
    case 'copy_file': {
      // עותק של קובץ לתיקייה אחרת (תיקיית הגשה לביקורת) — המקור לא זז
      const id = encodeURIComponent(String(input.fileId ?? ''))
      if (!id) throw new ToolError('invalid_argument', 'Drive: חסר fileId')
      const meta: Record<string, unknown> = {}
      if (input.title) meta.name = String(input.title)
      if (input.parentId) meta.parents = [String(input.parentId)]
      const r = await g(token, `${DRIVE}/${id}/copy?fields=id,name,mimeType,webViewLink&supportsAllDrives=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta) }, fetchImpl) as { id: string; name: string; mimeType: string; webViewLink?: string }
      return { id: r.id, title: r.name, mimeType: r.mimeType, viewUrl: r.webViewLink ?? null }
    }
    case 'download_file_content': {
      const id = encodeURIComponent(String(input.fileId))
      const meta = await g(token, `${DRIVE}/${id}?fields=id,name,mimeType&supportsAllDrives=true`, {}, fetchImpl) as { id: string; name: string; mimeType: string }
      const native = meta.mimeType.startsWith('application/vnd.google-apps.')
      const exportType = String(input.exportMimeType ?? 'application/pdf')
      const url = native ? `${DRIVE}/${id}/export?mimeType=${encodeURIComponent(exportType)}` : `${DRIVE}/${id}?alt=media&supportsAllDrives=true`
      const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } })
      if (!res.ok) throw new ToolError(res.status === 401 || res.status === 403 ? 'not_granted' : 'tool_error', `Drive ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      return { id: meta.id, title: meta.name, mimeType: native ? exportType : meta.mimeType, content: buf.toString('base64') }
    }
    case 'search_files': {
      const u = new URL(DRIVE)
      u.searchParams.set('q', driveQuery(String(input.query ?? '')))
      u.searchParams.set('pageSize', String(Math.min(Math.max(Number(input.pageSize) || 50, 1), 1000)))
      u.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,parents,shortcutDetails(targetId,targetMimeType))')
      u.searchParams.set('supportsAllDrives', 'true'); u.searchParams.set('includeItemsFromAllDrives', 'true')
      if (input.pageToken) u.searchParams.set('pageToken', String(input.pageToken))
      const r = await g(token, u, {}, fetchImpl) as { nextPageToken?: string; files?: { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; webViewLink?: string; parents?: string[]; shortcutDetails?: { targetId?: string; targetMimeType?: string } }[] }
      return {
        // קיצור דרך (WiseCard שומר כך חלק מהמסמכים) — מחזירים את הקובץ שהוא מצביע עליו, כדי שיוצג, ייפתח ויישלח כמו קובץ רגיל
        files: (r.files ?? []).map((f) => {
          const sc = f.mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails?.targetId ? f.shortcutDetails : null
          return { id: sc ? sc.targetId! : f.id, title: f.name, mimeType: sc ? sc.targetMimeType ?? f.mimeType : f.mimeType, modifiedTime: f.modifiedTime ?? null, fileSize: f.size ?? null, viewUrl: sc ? null : f.webViewLink ?? null, parentId: f.parents?.[0] ?? null, ...(sc ? { shortcut: true } : {}) }
        }),
        ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}),
      }
    }
    case 'update_file': {
      const id = encodeURIComponent(String(input.fileId ?? ''))
      if (!id) throw new ToolError('invalid_argument', 'Drive: חסר fileId')
      const u = new URL(`${DRIVE}/${id}`)
      u.searchParams.set('supportsAllDrives', 'true'); u.searchParams.set('fields', 'id,name,mimeType,webViewLink,parents')
      const body: Record<string, unknown> = {}
      if (input.title) body.name = String(input.title)
      if (input.parentId) {
        // העברה לתיקייה: מוסיפים את החדשה ומסירים את הקודמות (כמו "העבר אל" בדרייב)
        const cur = await g(token, `${DRIVE}/${id}?fields=parents&supportsAllDrives=true`, {}, fetchImpl) as { parents?: string[] }
        u.searchParams.set('addParents', String(input.parentId))
        const prev = (cur.parents ?? []).filter((p) => p !== input.parentId)
        if (prev.length) u.searchParams.set('removeParents', prev.join(','))
      }
      const r = await g(token, u, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl) as { id: string; name: string; mimeType: string; webViewLink?: string; parents?: string[] }
      return { id: r.id, title: r.name, mimeType: r.mimeType, viewUrl: r.webViewLink ?? null, parentId: r.parents?.[0] ?? null }
    }
    default: throw new ToolError('tool_not_found', `Drive: הכלי ${tool} לא ממומש בשרת`)
  }
}

/**
 * שפת השאילתה של החיבור של Claude → שפת השאילתה של Drive. הדף משתמש רק ב-parentId = '…';
 * גם title contains '…' נתמך. כל השאר נדחה במפורש — לא מעבירים לגוגל מחרוזת שלא הבנו.
 */
export function driveQuery(q: string): string {
  const out: string[] = []
  const id = /^[\w-]{1,200}$/
  for (const raw of q.split(/\s+and\s+/i)) {
    const part = raw.trim()
    let m: RegExpMatchArray | null
    if ((m = part.match(/^parentId\s*=\s*'([^']+)'$/)) && id.test(m[1]!)) out.push(`'${m[1]}' in parents`)
    else if ((m = part.match(/^(?:title|name)\s+contains\s+'([^'\\]{1,200})'$/))) out.push(`name contains '${m[1]}'`)
    else if ((m = part.match(/^mimeType\s*=\s*'([\w./+-]{1,200})'$/))) out.push(`mimeType = '${m[1]}'`)
    else throw new ToolError('invalid_argument', `Drive: שאילתה לא נתמכת: ${part}`)
  }
  out.push('trashed = false')
  return out.join(' and ')
}

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
/** יומן של מישהו אחר (האנליסט) — לפי המייל שלו, כמו calendarId בכלי של claude.ai. ברירת מחדל: היומן הראשי */
export const calUrl = (calendarId?: unknown) => calendarId ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(String(calendarId))}/events` : CAL
const TZ = 'Asia/Jerusalem'

/** "2026-10-14T09:00:00" בשעון ישראל → RFC3339 עם ההיסט של אותו רגע (קיץ +03:00, חורף +02:00). */
export function ilTime(local: string): string {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(local)) return local
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!m) throw new ToolError('invalid_argument', `Calendar: זמן לא תקין: ${local}`)
  const [y, mo, d, h = '00', mi = '00', se = '00'] = m.slice(1) as string[]
  const asUtc = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +se)
  const wall = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!)
  }
  // ההיסט ברגע עצמו (ולא ברגע ה-UTC המקביל) — נכון גם בשעות שסביב מעבר שעון
  let off = wall(asUtc) - asUtc
  off = wall(asUtc - off) - (asUtc - off)
  const mins = Math.round(off / 60000), sign = mins >= 0 ? '+' : '-', a = Math.abs(mins)
  return `${y}-${mo}-${d}T${h}:${mi}:${se}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

interface GEvent { id: string; status?: string; summary?: string; description?: string; location?: string; htmlLink?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }
const evOut = (e: GEvent) => ({ id: e.id, status: e.status ?? 'confirmed', summary: e.summary ?? '', description: e.description ?? '', location: e.location ?? '', htmlLink: e.htmlLink ?? null, start: e.start ?? {}, end: e.end ?? {} })

export async function calendarTool(tool: string, input: ToolInput, token: string, fetchImpl: F = fetch): Promise<unknown> {
  switch (tool) {
    case 'list_events':
    case 'search_events': {
      const u = new URL(calUrl(input.calendarId))
      u.searchParams.set('singleEvents', 'true'); u.searchParams.set('timeZone', TZ)
      u.searchParams.set('maxResults', String(Math.min(Math.max(Number(input.pageSize) || 50, 1), 250)))
      if (input.startTime) u.searchParams.set('timeMin', ilTime(String(input.startTime)))
      if (input.endTime) u.searchParams.set('timeMax', ilTime(String(input.endTime)))
      if (input.query) u.searchParams.set('q', String(input.query))
      if (input.orderBy === 'startTime' || input.startTime) u.searchParams.set('orderBy', 'startTime')
      if (input.pageToken) u.searchParams.set('pageToken', String(input.pageToken))
      const r = await g(token, u, {}, fetchImpl) as { items?: GEvent[]; nextPageToken?: string }
      return { events: (r.items ?? []).map(evOut), ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) }
    }
    case 'create_event': {
      if (!input.startTime || !input.summary) throw new ToolError('invalid_argument', 'Calendar: חסר summary או startTime')
      const at = (v: unknown) => ({ dateTime: String(v), timeZone: TZ })
      const body = {
        summary: String(input.summary), start: at(input.startTime), end: at(input.endTime ?? input.startTime),
        ...(input.description ? { description: String(input.description) } : {}), ...(input.location ? { location: String(input.location) } : {}),
        // משתתפים (הלקוח, המתאם) — מקבלים הזמנה מגוגל
        ...(Array.isArray(input.attendees) && input.attendees.length ? { attendees: (input.attendees as { email?: unknown; displayName?: unknown }[]).filter((a) => a && /@/.test(String(a.email))).map((a) => ({ email: String(a.email), ...(a.displayName ? { displayName: String(a.displayName) } : {}) })) } : {}),
      }
      const url = new URL(calUrl(input.calendarId))
      if (Array.isArray(input.attendees) && input.attendees.length) url.searchParams.set('sendUpdates', 'all')
      const e = await g(token, url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl) as unknown as GEvent
      return evOut(e)
    }
    default: throw new ToolError('tool_not_found', `Calendar: הכלי ${tool} לא ממומש בשרת`)
  }
}
