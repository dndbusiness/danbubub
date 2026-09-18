/**
 * Gmail — ADDENDUM ב.1: שליחה (ב.4, ב.7) וקריאה (ב.3). רק בניית הבקשות; הטוקן מגיע מ-lib/google/store.ts.
 */

export interface MailMessage { to: string[]; subject: string; html: string; from?: string; attachments?: { fileName: string; mimeType: string; content: Buffer }[] }

/** RFC 2822 עם UTF-8 (נושא ב-base64 encoded-word) — נדרש לעברית. */
export function buildMime(m: MailMessage): string {
  const subject = `=?UTF-8?B?${Buffer.from(m.subject, 'utf8').toString('base64')}?=`
  const headers = [`To: ${m.to.join(', ')}`, m.from ? `From: ${m.from}` : null, `Subject: ${subject}`, 'MIME-Version: 1.0'].filter(Boolean)
  if (!m.attachments?.length) {
    return [...headers, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(m.html, 'utf8').toString('base64')].join('\r\n')
  }
  const boundary = `harel_${Date.now().toString(36)}`
  const parts = [
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(m.html, 'utf8').toString('base64'),
    ...m.attachments.flatMap((a) => [
      `--${boundary}`, `Content-Type: ${a.mimeType}; name="${a.fileName}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="=?UTF-8?B?${Buffer.from(a.fileName, 'utf8').toString('base64')}?="`, '', a.content.toString('base64'),
    ]),
    `--${boundary}--`,
  ]
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts].join('\r\n')
}

export const base64url = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function sendMail(accessToken: string, m: MailMessage, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: base64url(buildMime(m)) }),
  })
  if (!res.ok) throw new Error(`Gmail send ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { id?: string }
  return data.id ?? 'sent'
}

/** ב.3 — שאילתת הסריקה. */
export const INTAKE_QUERY = 'has:attachment newer_than:1d (filename:pdf OR filename:xlsx OR filename:csv)'

export interface GmailMessageMeta { id: string; threadId: string; from: string; subject: string; date: string; attachments: { attachmentId: string; fileName: string; mimeType: string; size: number }[] }

export async function listMessages(accessToken: string, q: string, fetchImpl: typeof fetch = fetch, maxResults = 50): Promise<string[]> {
  const u = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  u.searchParams.set('q', q); u.searchParams.set('maxResults', String(maxResults))
  const res = await fetchImpl(u, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Gmail list ${res.status}`)
  const data = (await res.json()) as { messages?: { id: string }[] }
  return (data.messages ?? []).map((m) => m.id)
}

interface Part { mimeType?: string; filename?: string; body?: { attachmentId?: string; size?: number }; parts?: Part[] }

export function collectAttachments(part: Part | undefined, out: GmailMessageMeta['attachments'] = []): GmailMessageMeta['attachments'] {
  if (!part) return out
  if (part.filename && part.body?.attachmentId) out.push({ attachmentId: part.body.attachmentId, fileName: part.filename, mimeType: part.mimeType ?? 'application/octet-stream', size: part.body.size ?? 0 })
  for (const p of part.parts ?? []) collectAttachments(p, out)
  return out
}

export async function getMessage(accessToken: string, id: string, fetchImpl: typeof fetch = fetch): Promise<GmailMessageMeta> {
  const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Gmail get ${res.status}`)
  const data = (await res.json()) as { id: string; threadId: string; internalDate?: string; payload?: Part & { headers?: { name: string; value: string }[] } }
  const h = (n: string) => data.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? ''
  return { id: data.id, threadId: data.threadId, from: h('from'), subject: h('subject'), date: data.internalDate ? new Date(Number(data.internalDate)).toISOString() : '', attachments: collectAttachments(data.payload) }
}

export async function getAttachment(accessToken: string, messageId: string, attachmentId: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Gmail attachment ${res.status}`)
  const data = (await res.json()) as { data: string }
  return Buffer.from(data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** ב.3 שלב 7 — תיוג: מוצא/יוצר תווית ומצמיד להודעה. gmail.modify "לתיוג בלבד". */
export async function ensureLabel(accessToken: string, name: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const list = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers: { authorization: `Bearer ${accessToken}` } })
  const data = (await list.json()) as { labels?: { id: string; name: string }[] }
  const found = data.labels?.find((l) => l.name === name)
  if (found) return found.id
  const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  })
  if (!res.ok) throw new Error(`Gmail label ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

export async function addLabel(accessToken: string, messageId: string, labelId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ addLabelIds: [labelId] }),
  })
  if (!res.ok) throw new Error(`Gmail modify ${res.status}`)
}
