/**
 * וואטסאפ — Cloud API הרשמי של Meta (דן 22/11: "אני רוצה שהוואטסאפ יעבוד"). הכללים הטהורים: בלי I/O ובלי new Date() בלי ארגומנט.
 * החיבור: אותו חשבון WhatsApp Business שחובר ב-WISE (דו-קיום) — אפליקציית Meta של הר-אל נרשמת גם היא ל-webhooks של החשבון,
 * כך שהודעות נכנסות מגיעות גם ל-CRM, ושליחה יוצאת עם טוקן של משתמש מערכת. WISE ממשיכה לעבוד כרגיל.
 * תיעוד: docs/WHATSAPP.md
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { normPhone } from '@/lib/crm/inbound'

export interface WaConfig { token: string; phoneId: string; wabaId: string | null; verify: string | null; appSecret: string | null; version: string; base: string }
export function waConfig(env: Record<string, string | undefined> = process.env): WaConfig | null {
  if (!env.WA_CLOUD_TOKEN || !env.WA_PHONE_NUMBER_ID) return null
  return { token: env.WA_CLOUD_TOKEN, phoneId: env.WA_PHONE_NUMBER_ID, wabaId: env.WA_WABA_ID || null, verify: env.WA_VERIFY_TOKEN || null, appSecret: env.WA_APP_SECRET || null, version: env.WA_GRAPH_VERSION || 'v21.0', base: (env.WA_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/$/, '') /* בבדיקות: שרת מדומה */ }
}

/** 0501234567 / +972-50-123-4567 → 972501234567 (המספר כמו שהוא ב-API של וואטסאפ) */
export function toWa(phone: string): string { const d = normPhone(phone); return d ? '972' + d.replace(/^0/, '') : '' }
/** 972501234567 → 0501234567 (כמו שמספרים שמורים ב-CRM) */
export const fromWa = (wa: string): string => normPhone(wa)

/** חלון 24 השעות: הודעה חופשית מותרת רק עד 24 שעות מההודעה האחרונה של הלקוח; אחרי — רק תבנית מאושרת */
export function windowOpen(lastInAt: string | null | undefined, nowMs: number): boolean {
  const t = Date.parse(String(lastInAt || '')); return Number.isFinite(t) && nowMs - t < 24 * 3600e3
}
export function windowLeftMin(lastInAt: string | null | undefined, nowMs: number): number {
  const t = Date.parse(String(lastInAt || '')); return Number.isFinite(t) ? Math.max(0, Math.round((t + 24 * 3600e3 - nowMs) / 60000)) : 0
}

export interface WaIn { id: string; from: string; name: string; at: string; type: string; text: string; media: { id: string; mime: string; caption: string; filename: string } | null; replyTo: string | null }
export interface WaStatus { id: string; status: string; at: string; to: string; error: string | null }
type Obj = Record<string, unknown>
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : [])
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const iso = (ts: unknown): string => { const n = Number(ts); return Number.isFinite(n) && n > 1e9 ? new Date(n * 1000).toISOString() : '' }

/** גוף ה-webhook של Meta → הודעות נכנסות וסטטוסים (נשלח / נמסר / נקרא / נכשל) */
export function parseWebhook(body: unknown): { messages: WaIn[]; statuses: WaStatus[]; phoneIds: string[] } {
  const messages: WaIn[] = [], statuses: WaStatus[] = [], phoneIds: string[] = []
  for (const e of arr(obj(body).entry)) for (const ch of arr(e.changes)) {
    const v = obj(ch.value); if (ch.field && ch.field !== 'messages') continue
    const pid = String(obj(v.metadata).phone_number_id ?? ''); if (pid && !phoneIds.includes(pid)) phoneIds.push(pid)
    const names = new Map(arr(v.contacts).map((c) => [String(c.wa_id ?? ''), String(obj(c.profile).name ?? '')]))
    for (const m of arr(v.messages)) {
      const type = String(m.type ?? 'text'), body0 = obj(m[type])
      const text = type === 'text' ? String(obj(m.text).body ?? '') : type === 'button' ? String(obj(m.button).text ?? '') : type === 'interactive' ? String(obj(obj(m.interactive).button_reply).title ?? obj(obj(m.interactive).list_reply).title ?? '')
        : type === 'location' ? '📍 ' + [obj(m.location).name, obj(m.location).address].filter(Boolean).join(' · ') : type === 'reaction' ? String(obj(m.reaction).emoji ?? '') : String(body0.caption ?? '')
      const media = ['image', 'document', 'audio', 'video', 'sticker'].includes(type) && body0.id ? { id: String(body0.id), mime: String(body0.mime_type ?? ''), caption: String(body0.caption ?? ''), filename: String(body0.filename ?? '') } : null
      messages.push({ id: String(m.id ?? ''), from: String(m.from ?? ''), name: names.get(String(m.from ?? '')) || '', at: iso(m.timestamp), type, text, media, replyTo: obj(m.context).id ? String(obj(m.context).id) : null })
    }
    for (const s of arr(v.statuses)) {
      const err = arr(s.errors)[0]
      statuses.push({ id: String(s.id ?? ''), status: String(s.status ?? ''), at: iso(s.timestamp), to: String(s.recipient_id ?? ''), error: err ? String(obj(err.error_data).details ?? err.title ?? err.message ?? err.code ?? '') : null })
    }
  }
  return { messages: messages.filter((m) => m.id && m.from), statuses: statuses.filter((s) => s.id), phoneIds }
}

/** גוף השליחה ל-/{phone-number-id}/messages */
export function textPayload(to: string, text: string) { return { messaging_product: 'whatsapp', recipient_type: 'individual', to: toWa(to), type: 'text', text: { preview_url: true, body: String(text).slice(0, 4096) } } }
export function templatePayload(to: string, name: string, lang: string, params: string[] = []) {
  return { messaging_product: 'whatsapp', to: toWa(to), type: 'template', template: { name, language: { code: lang || 'he' }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }] } : {}) } }
}
/** כמה משתנים ({{1}}, {{2}}…) יש בגוף התבנית */
export function templateVars(components: unknown): number {
  const b = arr(components).find((c) => String(c.type).toUpperCase() === 'BODY'); const m = String(b?.text ?? '').match(/\{\{\s*\d+\s*\}\}/g); return m ? new Set(m).size : 0
}
export const templateBody = (components: unknown): string => String(arr(components).find((c) => String(c.type).toUpperCase() === 'BODY')?.text ?? '')
/** תבנית + פרמטרים → הטקסט שהלקוח רואה (לשמירה בשיחה) */
export const fillTemplate = (body: string, params: string[]): string => String(body).replace(/\{\{\s*(\d+)\s*\}\}/g, (m, i) => params[Number(i) - 1] ?? m)

/** שגיאת Graph → הודעה בעברית; permanent = ניסיון חוזר לא יעזור */
export function graphError(status: number, j: unknown): { message: string; permanent: boolean } {
  const e = obj(obj(j).error), code = Number(e.code), msg = String(e.error_user_msg ?? e.message ?? 'שגיאה')
  if (code === 131047 || /24 hours|re-engagement/i.test(msg)) return { message: 'עברו 24 שעות מההודעה האחרונה של הלקוח — אפשר לשלוח רק תבנית מאושרת', permanent: true }
  if (code === 190 || status === 401) return { message: 'הטוקן של וואטסאפ לא תקף (WA_CLOUD_TOKEN) — לחדש ב-Meta', permanent: true }
  if (code === 131026) return { message: 'המספר לא בוואטסאפ או לא יכול לקבל הודעות', permanent: true }
  if (code === 132001) return { message: 'התבנית לא קיימת או לא אושרה בשפה הזו', permanent: true }
  if (code === 131056 || code === 130429 || status === 429) return { message: 'יותר מדי הודעות — ננסה שוב', permanent: false }
  return { message: 'וואטסאפ: ' + msg + (code ? ' (' + code + ')' : ''), permanent: status >= 400 && status < 500 }
}

/** X-Hub-Signature-256 = 'sha256=' + HMAC-SHA256(הגוף הגולמי, סוד האפליקציה) */
export function signatureOk(raw: string, header: string | null, secret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false
  const want = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw, 'utf8').digest('hex')), got = Buffer.from(header)
  return want.length === got.length && timingSafeEqual(want, got)
}
