/**
 * וואטסאפ ↔ ה-CRM (דן 22/11). הכללים הטהורים ב-lib/rules/wa-cloud.ts. הנתונים ב-crm_docs:
 *   waMsgs/<id>     כל הודעה — נכנסת (in-<wamid>) או יוצאת (out-<uuid>, עם wamid אחרי השליחה) + סטטוס (נשלח / נמסר / נקרא / נכשל)
 *   waChats/<טלפון> שיחה אחת לכל מספר: הליד / הלקוח, ההודעה האחרונה, מתי הלקוח כתב לאחרונה (חלון 24 השעות), כמה לא נקראו
 *   waEvents/<id>   כל webhook גולמי (SERVER_ONLY)
 * מספר שלא מוכר (לא ליד ולא לקוח) → ליד חדש "וואטסאפ נכנס". כל שליחה — דרך תיבת היוצא (הנחיה 16).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { sql } from '@/lib/db'
import { writeDoc } from '@/lib/crm/store'
import { leadByPhone } from '@/lib/crm/voicenter'
import { phoneVariants } from '@/lib/crm/inbound'
import { flushOutbox } from '@/lib/jobs/outbox'
import { fromWa, parseWebhook, waConfig, windowOpen, type WaIn } from '@/lib/rules/wa-cloud'

type Doc = Record<string, unknown>
const safe = (s: string) => String(s).replace(/[^\w.\-:]/g, '_').slice(0, 180)
async function docById(coll: string, id: string): Promise<Doc | null> {
  const [r] = await sql<{ data: Doc }[]>`select data from crm_docs where coll = ${coll} and doc_id = ${id} and deleted_at is null`; return r?.data ?? null
}
async function clientByPhone(phone: string): Promise<{ id: string; data: Doc } | null> {
  const v = phoneVariants(phone); if (!v.length) return null
  const [r] = await sql<{ doc_id: string; data: Doc }[]>`select doc_id, data from crm_docs where coll = 'clients' and deleted_at is null
    and regexp_replace(coalesce(data->>'phone', ''), '\\D', '', 'g') = any(${v}::text[]) order by updated_at desc limit 1`
  return r ? { id: r.doc_id, data: r.data } : null
}
const preview = (m: { type: string; text: string; media?: unknown }) => (m.text || ({ image: '📷 תמונה', document: '📄 מסמך', audio: '🎤 הודעה קולית', video: '🎬 וידאו', sticker: 'מדבקה', location: '📍 מיקום' } as Record<string, string>)[m.type] || 'הודעה').slice(0, 160)

export async function logWaEvent(payload: unknown, now: Date): Promise<string> {
  const id = 'wa-' + now.getTime() + '-' + randomBytes(3).toString('hex')
  await writeDoc('waEvents/' + id, 'set', { payload, receivedAt: now.toISOString() }).catch(() => {}); return id
}

async function inbound(m: WaIn, now: Date): Promise<{ id: string; lead: string | null; client: string | null; createdLead: boolean; dup: boolean }> {
  const id = 'in-' + safe(m.id)
  if (await docById('waMsgs', id)) return { id, lead: null, client: null, createdLead: false, dup: true }
  const phone = fromWa(m.from), at = m.at || now.toISOString()
  const chat = await docById('waChats', phone)
  let leadId = (chat?.leadId as string) || null, clientId = (chat?.clientId as string) || null, createdLead = false
  if (!leadId && !clientId) { const l = await leadByPhone(phone); if (l) leadId = l.id; else { const c = await clientByPhone(phone); if (c) clientId = c.id } }
  if (!leadId && !clientId) {
    leadId = 'wa-' + phone + '-' + at.slice(0, 10)
    if (!(await docById('leads', leadId))) {
      await writeDoc('leads/' + leadId, 'set', { id: leadId, name: m.name || 'וואטסאפ ' + phone, phone, division: 'finance', source: 'whatsapp', channel: 'וואטסאפ', platform: 'וואטסאפ', stage: 'new', createdAt: at,
        log: [{ at, by: 'whatsapp', who: 'וואטסאפ', text: 'נפתח מהודעת וואטסאפ: ' + preview(m), auto: true }] })
      createdLead = true
    }
  }
  await writeDoc('waMsgs/' + id, 'set', { id, wamid: m.id, dir: 'in', phone, name: m.name || null, type: m.type, text: m.text, media: m.media, replyTo: m.replyTo, at, leadId, clientId, receivedAt: now.toISOString() })
  await writeDoc('waChats/' + phone, 'set', { ...(chat || {}), id: phone, phone, name: m.name || (chat?.name as string) || null, leadId, clientId, lastAt: at, lastText: preview(m), lastDir: 'in', lastInAt: at, unread: Number(chat?.unread || 0) + 1, updatedAt: now.toISOString() })
  return { id, lead: leadId, client: clientId, createdLead, dup: false }
}

async function status(s: { id: string; status: string; at: string; error: string | null }): Promise<boolean> {
  const [r] = await sql<{ doc_id: string; data: Doc }[]>`select doc_id, data from crm_docs where coll = 'waMsgs' and data->>'wamid' = ${s.id} and deleted_at is null limit 1`
  if (!r) return false
  const rank: Record<string, number> = { pending: 0, queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 }
  if ((rank[s.status] ?? 0) <= (rank[String(r.data.status)] ?? -1) && s.status !== 'failed') return true /* "נמסר" שמגיע אחרי "נקרא" לא מוריד */
  await writeDoc('waMsgs/' + r.doc_id, 'update', { status: s.status, [s.status + 'At']: s.at, ...(s.error ? { error: s.error } : {}) }); return true
}

export async function handleWaWebhook(body: unknown, now: Date) {
  const P = parseWebhook(body), cfg = waConfig()
  /* webhook של מספר אחר באותו חשבון (WISE יכולה לחבר כמה מספרים) — לא שלנו */
  if (cfg && P.phoneIds.length && !P.phoneIds.includes(cfg.phoneId)) return { ok: true, skipped: 'other_number', messages: 0, statuses: 0 }
  const res = []; for (const m of P.messages) res.push(await inbound(m, now))
  let st = 0; for (const s of P.statuses) if (await status(s)) st++
  return { ok: true, messages: res.filter((r) => !r.dup).length, createdLeads: res.filter((r) => r.createdLead).length, statuses: st }
}

export interface WaSend { phone: string; leadId?: string | null; clientId?: string | null; text?: string; template?: { name: string; lang?: string; params?: string[]; body?: string } | null; by: string }
export async function sendWa(o: WaSend, now: Date): Promise<{ ok: boolean; id?: string; error?: string; status?: string }> {
  const cfg = waConfig(); if (!cfg) return { ok: false, error: 'וואטסאפ לא מחובר בשרת (WA_CLOUD_TOKEN / WA_PHONE_NUMBER_ID)' }
  const phone = fromWa(o.phone); if (!/^0\d{8,9}$/.test(phone)) return { ok: false, error: 'מספר טלפון לא תקין' }
  const chat = await docById('waChats', phone), tpl = o.template && o.template.name ? o.template : null, text = String(o.text || '').trim()
  if (!tpl && !text) return { ok: false, error: 'אין מה לשלוח' }
  if (!tpl && !windowOpen(chat?.lastInAt as string, now.getTime())) return { ok: false, error: 'עברו 24 שעות מההודעה האחרונה של הלקוח (או שהוא עוד לא כתב) — אפשר לשלוח רק תבנית מאושרת' }
  const local = 'out-' + randomUUID(), shown = tpl ? (tpl.body || ('תבנית: ' + tpl.name)).replace(/\{\{\s*(\d+)\s*\}\}/g, (m, i) => (tpl.params || [])[Number(i) - 1] ?? m) : text
  const leadId = o.leadId ?? (chat?.leadId as string) ?? null, clientId = o.clientId ?? (chat?.clientId as string) ?? null
  await writeDoc('waMsgs/' + local, 'set', { id: local, dir: 'out', phone, type: tpl ? 'template' : 'text', text: shown, template: tpl ? { name: tpl.name, lang: tpl.lang || 'he', params: tpl.params || [] } : null, at: now.toISOString(), by: o.by, leadId, clientId, status: 'pending' })
  const key = 'wa:' + local
  const [ins] = await sql<{ id: string }[]>`insert into outbox (channel, target, subject, body, payload, dedup_key)
    values ('whatsapp', ${phone}, ${'וואטסאפ'}, ${shown}, ${sql.json((tpl ? { wa: { kind: 'template', name: tpl.name, lang: tpl.lang || 'he', params: tpl.params || [] } } : { wa: { kind: 'text', text } }) as never)}, ${key}) returning id`
  await flushOutbox({ ids: [ins!.id] }).catch((e) => console.error('outbox:', (e as Error).message))
  const [r] = await sql<{ status: string; last_error: string | null; payload: { messageId?: string } | null }[]>`select status, last_error, payload from outbox where id = ${ins!.id}`
  const sent = r?.status === 'sent', st = sent ? 'sent' : r?.status === 'failed' ? 'failed' : 'queued'
  await writeDoc('waMsgs/' + local, 'update', { status: st, ...(sent ? { wamid: r?.payload?.messageId ?? null, sentAt: now.toISOString() } : {}), ...(r?.last_error ? { error: r.last_error } : {}), outboxId: ins!.id })
  await writeDoc('waChats/' + phone, 'set', { ...(chat || {}), id: phone, phone, leadId, clientId, lastAt: now.toISOString(), lastText: shown.slice(0, 160), lastDir: 'out', unread: 0, updatedAt: now.toISOString() })
  return sent ? { ok: true, id: local, status: st } : { ok: false, id: local, status: st, error: r?.last_error || (st === 'queued' ? 'ממתין בתור — ננסה שוב אוטומטית' : 'לא נשלח') }
}
