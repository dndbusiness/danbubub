/**
 * קליטה מבחוץ (דן, 15/10): לידים ממערכות חיצוניות (API / webhook) ושיחות מהמרכזייה (וויאסנטר).
 * הפונקציות כאן טהורות — הנתיבים ב-app/api/crm/inbound/* מאמתים מפתח, קוראים ממסד וכותבים דרך writeDoc.
 * כל קליטה idempotent (הנחיה 9): אותו ליד באותן 10 דקות / אותה שיחה (CallID) = 0 שורות חדשות.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export const normPhone = (p: unknown): string => {
  let d = String(p ?? '').replace(/\D/g, '')
  if (d.startsWith('972')) d = '0' + d.slice(3)
  if (/^00\d{9}$/.test(d)) d = d.slice(1)
  if (/^5\d{8}$/.test(d)) d = '0' + d
  return d
}
/** הוריאציות שהטלפון עשוי להיות שמור בהן במסד */
export const phoneVariants = (p: string): string[] => { const d = normPhone(p); return d ? [...new Set([d, d.replace(/^0/, ''), '972' + d.replace(/^0/, '')])] : [] }

export function keyOk(given: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !given) return false
  const a = Buffer.from(String(given)), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const pick = (o: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) { const hit = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase()); if (hit && o[hit] != null && String(o[hit]).trim()) return String(o[hit]).trim() }
  return ''
}
const KNOWN = ['name', 'full_name', 'fullname', 'שם', 'שם מלא', 'phone', 'phone_number', 'mobile', 'tel', 'טלפון', 'email', 'מייל', 'campaign', 'campaign_name', 'קמפיין', 'source', 'platform', 'מקור',
  'ad', 'ad_name', 'מודעה', 'city', 'עיר', 'division', 'company', 'type', 'ctype', 'סוג', 'notes', 'note', 'הערות', 'answers', 'key', 'cls', 'classification', 'סיווג', 'created_time', 'created_at']

export interface InboundLead { id: string; doc: Record<string, unknown> }
/** גוף בקשה חופשי (JSON / טופס / Facebook / Zapier) → ליד במבנה של ה-CRM. שדות לא מוכרים נשמרים כתשובות. */
export function leadFromPayload(body: Record<string, unknown>, now: Date, opts: { defaultResp?: Record<string, string | null> } = {}): InboundLead | { error: string } {
  const phone = normPhone(pick(body, 'phone', 'phone_number', 'mobile', 'tel', 'טלפון'))
  const name = pick(body, 'name', 'full_name', 'fullname', 'שם מלא', 'שם')
  if (!phone && !name) return { error: 'חסר שם או טלפון' }
  const div = /real|נדל|השקעות/i.test(pick(body, 'division', 'company')) ? 'realestate' : 'finance'
  const source = pick(body, 'source', 'platform', 'מקור') || 'API'
  const minute = now.toISOString().slice(0, 15) // חלון של 10 דקות — כפילויות משליחה חוזרת
  const id = 'api-' + createHash('sha1').update((phone || name) + '|' + source + '|' + minute).digest('hex').slice(0, 16)
  const answers: Record<string, string> = {}
  const extra = body.answers && typeof body.answers === 'object' ? body.answers as Record<string, unknown> : {}
  for (const [k, v] of [...Object.entries(body), ...Object.entries(extra)]) if (!KNOWN.includes(k.toLowerCase()) && v != null && typeof v !== 'object' && String(v).trim()) answers[k] = String(v).trim().slice(0, 500)
  const at = now.toISOString()
  const resp = (opts.defaultResp ?? {})[div] ?? (div === 'finance' ? 'nissim' : null)
  return { id, doc: {
    id, name: name || phone, phone, email: pick(body, 'email', 'מייל'), campaign: pick(body, 'campaign', 'campaign_name', 'קמפיין'), platform: source, channel: source, marketer: source,
    ad: pick(body, 'ad', 'ad_name', 'מודעה'), city: pick(body, 'city', 'עיר'), division: div, ctype: pick(body, 'type', 'ctype', 'סוג') || null, cls: pick(body, 'cls', 'classification', 'סיווג') || null,
    note: pick(body, 'notes', 'note', 'הערות'), answers, stage: 'new', source: 'api', resp, createdAt: at, updatedAt: at,
    log: [{ at, by: 'api', who: 'API', text: 'נכנס מ-' + source, auto: true }],
  } }
}

/** שיחה מוויאסנטר (CDR). השדות בפועל — לפי ההגדרה בחשבון; כאן קוראים כמה שמות מקובלים, ומה שלא זוהה נשמר גולמי. */
export interface CallRec { id: string; at: string; secs: number; kind: 'none' | 'pickup' | 'effective'; dir: 'out' | 'in'; by: string | null; rep: string; src: 'voicenter'; rec?: string }
export function callFromVoicenter(b: Record<string, unknown>, reps: Record<string, string> = {}): { phones: string[]; call: CallRec } | { error: string } {
  const type = pick(b, 'Type', 'type', 'CallType', 'direction')
  const dir: 'out' | 'in' = /out|יוצא/i.test(type) ? 'out' : /in|נכנס/i.test(type) ? 'in' : 'out'
  const caller = normPhone(pick(b, 'caller', 'Caller', 'CallerNumber', 'from')), target = normPhone(pick(b, 'target', 'Target', 'DialedNumber', 'to', 'destination'))
  const phones = [...new Set((dir === 'out' ? [target, caller] : [caller, target]).filter((p) => p.length >= 9))]
  if (!phones.length) return { error: 'אין מספר טלפון בשיחה' }
  const secs = Math.max(0, Math.round(Number(pick(b, 'Duration', 'duration', 'BillSec', 'TalkTime', 'talk_time')) || 0))
  const status = pick(b, 'DialStatus', 'Status', 'status', 'disposition')
  const answered = secs > 0 && !/NOANSWER|NO ANSWER|BUSY|FAIL|CANCEL|לא נענה/i.test(status)
  const t = pick(b, 'time', 'Time', 'start', 'StartTime', 'date')
  const at = /^\d{9,11}$/.test(t) ? new Date(Number(t) * 1000).toISOString() : t && !isNaN(Date.parse(t)) ? new Date(t).toISOString() : new Date().toISOString()
  const rep = pick(b, 'RepresentativeName', 'representative', 'Extension', 'extension', 'agent', 'user')
  const id = 'vc-' + (pick(b, 'CallID', 'callId', 'call_id', 'ivruniqueid', 'uniqueid') || createHash('sha1').update(phones[0] + '|' + at + '|' + secs).digest('hex').slice(0, 16))
  const recUrl = pick(b, 'RecordURL', 'recording', 'record_url')
  return { phones, call: { id, at, secs, kind: !answered ? 'none' : secs >= 60 ? 'effective' : 'pickup', dir, by: (rep && (reps[rep] ?? reps[rep.toLowerCase()])) || null, rep, src: 'voicenter', ...(recUrl ? { rec: recUrl } : {}) } }
}
