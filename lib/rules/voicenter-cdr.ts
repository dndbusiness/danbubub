/**
 * וויאסנטר — CDR (שיחה שהסתיימה) ו-Pop-Up: הכללים הטהורים. בלי I/O ובלי new Date() בלי ארגומנט.
 * הנתיבים: app/api/voicenter/cdr · popup · call (lib/crm/voicenter.ts מדבר עם המסד).
 * תיעוד: https://www.voicenter.com/API/CDR-Notification-System-API
 *
 * שמות השדות בתיעוד לא עקביים באותיות (DepartmentId / DepartmentID) — כל קריאה כאן case-insensitive,
 * והגוף המקורי נשמר תמיד (vcEvents).
 */
import { normPhone } from '@/lib/crm/inbound'

export const normalizePhone = normPhone

type Obj = Record<string, unknown>
const lowerMap = (o: Obj) => { const m = new Map<string, unknown>(); for (const [k, v] of Object.entries(o ?? {})) m.set(k.toLowerCase(), v); return m }
/** הערך הראשון שקיים מבין השמות (בלי תלות באותיות גדולות) */
export function field(o: Obj, ...names: string[]): string {
  const m = lowerMap(o)
  for (const n of names) { const v = m.get(n.toLowerCase()); if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim() }
  return ''
}
const num = (s: string) => { const x = Number(String(s).replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : 0 }

/**
 * "time" ב-CDR = epoch של שעון הקיר בישראל (לא UTC). כלומר מספר השניות כאילו השעה המקומית הייתה UTC.
 * מחזיר את הרגע האמיתי (ISO, UTC): מורידים את הפרש השעון של ישראל באותו רגע (2 בחורף, 3 בקיץ).
 */
export function israelWallEpochToIso(sec: number): string {
  const wall = sec * 1000
  // ההפרש בשעון ישראל סביב הרגע (שני ניסיונות — סביב מעבר שעון)
  const off = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]))
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - t
  }
  let utc = wall - off(wall)
  utc = wall - off(utc)
  return new Date(utc).toISOString()
}

export type CallDir = 'in' | 'out' | 'internal'
export interface CdrCall {
  ivr: string; originalIvr: string | null; dir: CallDir; type: string; status: string; answered: boolean
  customer: string; caller: string; target: string; did: string; ext: string
  at: string; durationSec: number; talkSec: number; ringSec: number
  queue: string; record: string; priceAgorot: number; rep: string; repCode: string
  campaign: string; dialerCallId: string; custom: Record<string, string>; leadId: string | null
  leg: 'leg1' | 'leg2' | null; hidden: boolean; aiSummary: string; aiTranscript: unknown[] | null
}

/** CustomData (אובייקט או מחרוזת JSON) + כל שדה var_* בשורש */
export function customOf(b: Obj): Record<string, string> {
  const out: Record<string, string> = {}
  let cd: unknown = Object.entries(b).find(([k]) => k.toLowerCase() === 'customdata')?.[1]
  if (typeof cd === 'string') { try { cd = JSON.parse(cd) } catch { cd = null } }
  if (cd && typeof cd === 'object') for (const [k, v] of Object.entries(cd as Obj)) if (v != null) out[k] = String(v)
  for (const [k, v] of Object.entries(b)) if (/^var_/i.test(k) && v != null) out[k] = String(v)
  return out
}

export function parseCdr(b: Obj, now: Date): CdrCall | { error: string } {
  const ivr = field(b, 'ivruniqueid', 'IvrUniqueID', 'ivr_unique_id')
  if (!ivr) return { error: 'חסר ivruniqueid' }
  const type = field(b, 'type', 'CallType'), dRaw = field(b, 'direction')
  const dir: CallDir = /internal|פנימ/i.test(dRaw) ? 'internal' : /^in|incoming|נכנס/i.test(dRaw) ? 'in' : /^out|outgoing|יוצא/i.test(dRaw) ? 'out'
    : /incoming|queue|voicemail/i.test(type) ? 'in' : /internal/i.test(type) ? 'internal' : 'out'
  const caller = normPhone(field(b, 'callerPhone', 'caller')), target = normPhone(field(b, 'target', 'targetPhone'))
  const status = field(b, 'status').toUpperCase()
  const isAns = field(b, 'isAnswer', 'isAnswered')
  const answered = isAns ? num(isAns) === 1 : status === 'ANSWER'
  const t = num(field(b, 'time', 'start'))
  const legM = /(?:click2call|productivecall)\s*leg\s*([12])/i.exec(type)
  const leg = legM ? (legM[1] === '1' ? 'leg1' : 'leg2') as 'leg1' | 'leg2' : null
  const custom = customOf(b)
  const ai = Object.entries(b).find(([k]) => k.toLowerCase() === 'aidata')?.[1] as Obj | undefined
  const insights = ai && typeof ai === 'object' ? (Object.entries(ai).find(([k]) => k.toLowerCase() === 'insights')?.[1] as Obj | undefined) : undefined
  const transcript = ai && typeof ai === 'object' ? (Object.entries(ai).find(([k]) => k.toLowerCase() === 'transcript')?.[1]) : undefined
  return {
    ivr, originalIvr: field(b, 'OriginalIvrUniqueID') || null, dir, type, status: status || (answered ? 'ANSWER' : ''), answered,
    customer: dir === 'in' ? caller : target, caller, target, did: normPhone(field(b, 'did', 'DID')) || field(b, 'did', 'DID'),
    ext: field(b, ...(dir === 'in' ? ['targetextension', 'extenUser', 'callerextension'] : ['callerextension', 'extenUser', 'targetextension'])),
    at: t > 1e9 ? israelWallEpochToIso(t) : now.toISOString(),
    durationSec: Math.round(num(field(b, 'duration'))), talkSec: Math.round(num(field(b, 'actualCallDuration', 'talktime'))), ringSec: Math.round(num(field(b, 'dialtime', 'ringtime'))),
    queue: field(b, 'queuename', 'queueName'), record: field(b, 'record', 'RecordURL', 'recording'), priceAgorot: Math.round(num(field(b, 'price'))),
    rep: field(b, 'representative_name', 'RepresentativeName'), repCode: field(b, 'representative_code', 'RepresentativeCode'),
    campaign: field(b, 'campaignName'), dialerCallId: field(b, 'CallID'), custom,
    leadId: custom.var_leadId || custom.leadId || null,
    leg, hidden: leg === 'leg1',
    aiSummary: insights && typeof insights === 'object' ? field(insights, 'summary') : '',
    aiTranscript: Array.isArray(transcript) ? transcript.slice(0, 400) : null,
  }
}

/** סטטוס בעברית לכרטיס */
export function callStatusHe(c: Pick<CdrCall, 'answered' | 'status' | 'dir'>): string {
  if (c.answered) return 'נענתה'
  const s = c.status
  if (s === 'BUSY') return 'תפוס'
  if (s === 'ABANDONE' || s === 'ABANDON') return 'ננטשה בתור'
  if (s === 'VOICEMAIL') return 'הודעה קולית'
  if (s === 'CANCEL') return c.dir === 'in' ? 'הלקוח ניתק' : 'בוטלה'
  return 'לא נענתה'
}

/** הרשומה הקצרה בליד (leads.calls[]) — אותו מבנה שהדף כבר מציג ומונה (מתחת לדקה = הרמה, מעל = אפקטיבית) */
export function leadCallRec(c: CdrCall, by: string | null) {
  const secs = c.talkSec || (c.answered ? c.durationSec : 0)
  return { id: 'vc-' + c.ivr, at: c.at, secs, kind: !c.answered ? 'none' : secs >= 60 ? 'effective' : 'pickup', dir: c.dir === 'in' ? 'in' : 'out', by, rep: c.rep, src: 'voicenter', ...(c.record ? { rec: c.record } : {}) }
}

/** שיחה נכנסת שלא נענתה מליד קיים → משימת חזרה (rule_key ייחודי לשיחה — הנחיה 18) */
export const missedTaskKey = (ivr: string) => 'vc-missed:' + ivr
export const missedNeedsTask = (c: CdrCall) => c.dir === 'in' && !c.answered && !c.hidden && c.customer.length >= 9

/** Pop-Up: רק בשלב Ringing מקפיצים; בשאר השלבים — OK בלי כלום */
export const popupStage = (b: Obj) => field(b, 'status', 'statusCall').toLowerCase()
export function popupAnswer(o: { base: string; lead: { id: string; name?: string; stage?: string; resp?: string } | null; total: number; phone: string; stageLabel?: string; respLabel?: string }) {
  if (!o.lead) return { STATUS: 'OK', URL: `${o.base}/crm#newlead:${encodeURIComponent(o.phone)}`, CLIENTNAME: 'לקוח חדש', TOTAL: 0, COMPANY: 'לא נמצא במערכת — לחיצה פותחת ליד חדש' }
  return { STATUS: 'OK', URL: `${o.base}/crm#lead:${encodeURIComponent(o.lead.id)}`, CLIENTNAME: o.lead.name || o.phone, TOTAL: o.total,
    COMPANY: [o.stageLabel ? 'שלב: ' + o.stageLabel : '', o.respLabel ? 'אחראי: ' + o.respLabel : ''].filter(Boolean).join(' · ') || 'ליד קיים' }
}

/** Click2Call — הבקשה (POST-JSON) ותשובות השגיאה בעברית */
export function click2callBody(code: string, ext: string, target: string, vars: Record<string, string> = {}) {
  const v: Record<string, string> = {}
  for (const [k, x] of Object.entries(vars).slice(0, 10)) if (x) v[k.startsWith('var_') ? k : 'var_' + k] = String(x)
  return { code, action: 'call', phone: ext, target, record: 'true', format: 'json', checkphonedevicestate: 'true', ...v }
}
export const C2C_ERRORS: Record<number, string> = {
  0: 'השלוחה שלך מצלצלת — ענה כדי להתחבר ללקוח', 1: 'שגיאה בפרטי החיוג', 2: 'שגיאה במרכזייה, נסה שוב',
  3: 'השלוחה שלך לא מחוברת — פתח את הטלפון או את האפליקציה', 4: 'השלוחה חסומה לחיוג מהמערכת',
}
export function click2callResult(status: number, text: string): { ok: boolean; code: number | null; message: string; callId: string | null } {
  if (status < 200 || status >= 300) return { ok: false, code: null, message: 'המרכזייה החזירה ' + status, callId: null }
  let j: Obj | null = null
  try { j = JSON.parse(text) } catch { /* XML / טקסט */ }
  const codeS = j ? field(j, 'ERRORCODE', 'ErrorCode') : (/<ERRORCODE>\s*(-?\d+)/i.exec(text) || [])[1] ?? ''
  const code = codeS === '' ? null : Number(codeS)
  const msg = j ? field(j, 'ERRORMESSAGE', 'ErrorMessage') : ((/<ERRORMESSAGE>([^<]*)/i.exec(text) || [])[1] ?? '')
  const callId = j ? field(j, 'CALLID', 'CallID') || null : null
  if (code === 0) return { ok: true, code, message: C2C_ERRORS[0]!, callId }
  if (code === null) return { ok: false, code, message: 'תשובה לא מוכרת מהמרכזייה' + (msg ? ': ' + msg : ''), callId }
  return { ok: false, code, message: C2C_ERRORS[code] ?? ('שגיאה ' + code + (msg ? ': ' + msg : '')), callId }
}
