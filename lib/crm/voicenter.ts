/**
 * וויאסנטר ↔ ה-CRM: מה שקורה מול המסד. הכללים הטהורים ב-lib/rules/voicenter-cdr.ts.
 *
 * מותאם למה שכבר קיים: הנתונים של ה-CRM יושבים ב-crm_docs (לא בטבלאות נפרדות) —
 *   calls/<ivruniqueid>   כל שיחה (upsert לפי המזהה — וויאסנטר שולחת כל CDR פעמיים)
 *   vcEvents/<id>         כל בקשה גולמית מוויאסנטר + סטטוס עיבוד (SERVER_ONLY — לא יוצא לדפדפן)
 *   leads/<id>.calls[]    הרשומה הקצרה שהדף כבר מציג ומונה, + lastCallAt / callsCount
 *   tasks/vcm-<…>         שיחה נכנסת שלא נענתה → "לחזור ללקוח" (ruleKey ייחודי לשיחה)
 */
import { randomBytes } from 'node:crypto'
import { sql } from '@/lib/db'
import { writeDoc } from '@/lib/crm/store'
import { crmSettings } from '@/lib/crm/auth'
import { phoneVariants } from '@/lib/crm/inbound'
import { repMap } from '@/lib/rules/voicenter'
import { leadCallRec, missedNeedsTask, missedTaskKey, parseCdr, type CdrCall } from '@/lib/rules/voicenter-cdr'

type Doc = Record<string, unknown>
const safeId = (s: string) => String(s).replace(/[^\w.\-:]/g, '_').slice(0, 180)

export async function logEvent(kind: string, payload: unknown, now: Date): Promise<string> {
  const id = kind + '-' + now.getTime() + '-' + randomBytes(3).toString('hex')
  await writeDoc('vcEvents/' + id, 'set', { kind, payload, receivedAt: now.toISOString(), processed: false }).catch(() => {})
  return id
}
export async function markEvent(id: string, ok: boolean, info: Doc = {}): Promise<void> {
  await writeDoc('vcEvents/' + id, 'update', { processed: ok, ...info }).catch(() => {})
}

/** הליד החדש ביותר עם הטלפון הזה (בכל הפורמטים שבהם הוא עשוי להיות שמור) */
export async function leadByPhone(phone: string): Promise<{ id: string; data: Doc } | null> {
  const v = phoneVariants(phone); if (!v.length) return null
  const [r] = await sql<{ doc_id: string; data: Doc }[]>`select doc_id, data from crm_docs where coll = 'leads' and deleted_at is null
    and regexp_replace(coalesce(data->>'phone', ''), '\\D', '', 'g') = any(${v}::text[]) order by updated_at desc limit 1`
  return r ? { id: r.doc_id, data: r.data } : null
}
export async function leadsCountByPhone(phone: string): Promise<number> {
  const v = phoneVariants(phone); if (!v.length) return 0
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from crm_docs where coll = 'leads' and deleted_at is null
    and regexp_replace(coalesce(data->>'phone', ''), '\\D', '', 'g') = any(${v}::text[])`
  return r?.n ?? 0
}
async function clientByPhone(phone: string): Promise<{ id: string; data: Doc } | null> {
  const v = phoneVariants(phone); if (!v.length) return null
  const [r] = await sql<{ doc_id: string; data: Doc }[]>`select doc_id, data from crm_docs where coll = 'clients' and deleted_at is null
    and regexp_replace(coalesce(data->>'phone', ''), '\\D', '', 'g') = any(${v}::text[]) order by updated_at desc limit 1`
  return r ? { id: r.doc_id, data: r.data } : null
}
async function docById(coll: string, id: string): Promise<Doc | null> {
  const [r] = await sql<{ data: Doc }[]>`select data from crm_docs where coll = ${coll} and doc_id = ${id} and deleted_at is null`
  return r?.data ?? null
}

/** הנציג: לפי השלוחה, אחרת לפי שם / קוד הנציג (מיפוי ידני ב-voicenterReps) */
export function repKeyOf(c: Pick<CdrCall, 'ext' | 'rep' | 'repCode'>, map: Record<string, string>): string | null {
  for (const k of [c.ext, c.repCode, c.rep]) { const v = map[String(k ?? '').trim().toLowerCase()]; if (v) return v }
  return null
}

export interface CdrResult { ok: boolean; error?: string; call?: string; lead?: string | null; client?: string | null; createdLead?: boolean; task?: string | null; duplicate?: boolean }

export async function handleCdr(body: Doc, now: Date): Promise<CdrResult> {
  const c = parseCdr(body, now)
  if ('error' in c) return { ok: false, error: c.error }
  const settings = (await crmSettings()) as Doc
  const by = repKeyOf(c, repMap(settings as never))
  const callId = safeId(c.ivr)
  const prev = await docById('calls', callId)

  // הלקוח: var_leadId (מהחיוג / החייגן) גובר; אחרת לפי הטלפון — ליד, ואם אין — לקוח קיים
  let lead: { id: string; data: Doc } | null = null
  if (c.leadId) { const d = await docById('leads', c.leadId); if (d) lead = { id: c.leadId, data: d } }
  if (!lead && !c.hidden && c.dir !== 'internal' && c.customer) lead = await leadByPhone(c.customer)
  const client = !lead && c.customer && c.dir !== 'internal' ? await clientByPhone(c.customer) : null

  // שיחה נכנסת ממספר שלא מוכר (לא ליד ולא לקוח) → ליד חדש, "שיחה נכנסת" (או החברה לפי ה-DID בהגדרות)
  let createdLead = false
  if (!lead && !client && !prev && c.dir === 'in' && !c.hidden && c.customer.length >= 9) {
    const didDiv = ((settings.vcDidDivision as Record<string, string> | undefined) ?? {})[c.did] === 'realestate' ? 'realestate' : 'finance'
    const id = 'vc-' + c.customer + '-' + c.at.slice(0, 10)
    const data: Doc = { id, name: 'שיחה נכנסת ' + c.customer, phone: c.customer, division: didDiv, source: 'voicenter', channel: 'שיחה נכנסת', platform: 'שיחה נכנסת',
      stage: 'new', createdAt: c.at, ...(c.did ? { did: c.did } : {}), ...(by && c.answered ? { resp: by } : {}),
      log: [{ at: c.at, by: 'voicenter', who: 'מרכזייה', text: 'נפתח משיחה נכנסת' + (c.answered ? ' (נענתה' + (c.rep ? ' ע"י ' + c.rep : '') + ')' : ' שלא נענתה'), auto: true }] }
    await writeDoc('leads/' + id, 'set', data)
    lead = { id, data }; createdLead = true
  }

  // השיחה עצמה — upsert לפי ivruniqueid (שליחה כפולה = אותו מסמך)
  const rec: Doc = { ...c, id: callId, leadId: lead?.id ?? null, clientId: client?.id ?? null, by, receivedAt: (prev?.receivedAt as string) ?? now.toISOString(), updatedAt: now.toISOString() }
  const same = prev && JSON.stringify({ ...prev, receivedAt: 0, updatedAt: 0 }) === JSON.stringify({ ...rec, receivedAt: 0, updatedAt: 0 })
  if (!same) await writeDoc('calls/' + callId, 'set', rec)

  // בכרטיס הליד: הרשומה הקצרה (רק leg2 / שיחה רגילה), בלי כפילויות
  if (lead && !c.hidden) {
    const short = leadCallRec(c, by), calls = (Array.isArray(lead.data.calls) ? lead.data.calls : []) as Doc[]
    if (!calls.some((x) => x.id === short.id)) {
      const next = [...calls, short].slice(-200)
      await writeDoc('leads/' + lead.id, 'update', { calls: next, lastCallAt: c.at, callsCount: next.length })
    }
  }

  // נכנסת שלא נענתה → משימת "לחזור ללקוח" לאחראי (אחת לשיחה — ruleKey)
  let task: string | null = null
  if (lead && missedNeedsTask(c)) {
    task = 'vcm-' + safeId(c.ivr).slice(0, 120)
    if (!(await docById('tasks', task))) {
      const name = String(lead.data.name ?? c.customer)
      await writeDoc('tasks/' + task, 'set', { id: task, ruleKey: missedTaskKey(c.ivr), auto: true, leadId: lead.id, title: 'לחזור ללקוח — שיחה שלא נענתה: ' + name,
        notes: c.customer + ' · ' + c.at.slice(0, 16).replace('T', ' ') + (c.queue ? ' · תור ' + c.queue : ''), resp: (lead.data.resp as string) || by || null,
        due: c.at.slice(0, 10), priority: 'high', status: 'open', createdAt: now.toISOString(), createdBy: 'voicenter',
        ...(lead.data.division ? { division: lead.data.division } : {}) })
    }
  }
  return { ok: true, call: callId, lead: lead?.id ?? null, client: client?.id ?? null, createdLead, task, duplicate: !!same }
}
