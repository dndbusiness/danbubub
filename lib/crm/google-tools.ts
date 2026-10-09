/**
 * הכלים שהדף של ה-CRM קורא להם דרך "חיבורים" של Claude (Gmail / Google Drive),
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

const viewUrl = (threadId: string, account: string | null) => `https://mail.google.com/mail/${account ? `?authuser=${encodeURIComponent(account)}` : ''}#all/${threadId}`

export async function gmailTool(tool: string, input: ToolInput, token: string, account: string | null, fetchImpl: F = fetch): Promise<unknown> {
  switch (tool) {
    case 'send_message': {
      const to = (input.to as string[] | undefined) ?? []
      if (!to.length) throw new ToolError('invalid_argument', 'אין נמען')
      const atts = ((input.attachments as { filename: string; mimeType: string; content: string }[] | undefined) ?? [])
        .map((a) => ({ fileName: a.filename, mimeType: a.mimeType, content: Buffer.from(a.content, 'base64') }))
      const raw = base64url(buildMime({ to, subject: String(input.subject ?? ''), html: String(input.htmlBody ?? input.body ?? ''), attachments: atts }))
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
      return { id: th.id, messages: (th.messages ?? []).map((x) => ({ ...msgView(x, account), plaintextBody: plainBody(x.payload) })) }
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
    default: throw new ToolError('tool_not_found', `Drive: הכלי ${tool} לא ממומש בשרת`)
  }
}
