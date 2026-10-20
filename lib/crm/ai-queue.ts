/**
 * ניתוחי Claude על המנוי — בלי מפתח API בתשלום (התוכנית: "Claude כמנהל תיקים").
 *
 * הלולאה:
 *   1. הדף מבקש ניתוח (claude.use('sample') בשים) → נכנסת בקשה לתור: aiJobs/<id>, והתמונות בנפרד ב-aiJobFiles.
 *   2. Claude על המנוי (שגרה של Claude Code, scripts/ai-queue.mjs) מושך את הבקשות, עונה, ומחזיר את התשובה.
 *   3. השרת שומר את התשובה בבקשה, ואם ביקשו — גם בתיק עצמו (למשל intakes/<id>.ai) ובשורה ביומן הלקוח.
 *      כך התוצאה חוזרת לתיק גם אם מי שביקש כבר סגר את הדף.
 * התשובה היא הצעה בלבד (הנחיה 17) — הדף מציג, אדם מאשר. התור דלוק רק כשהמעבד חי (דופק ב-30 הדקות האחרונות).
 */
import { randomUUID } from 'node:crypto'
import { sql } from '@/lib/db'
import { writeDoc } from '@/lib/crm/store'
import type { CrmSession } from '@/lib/crm/auth'

/** אוספים שלא יוצאים לדפדפן ולא נכתבים ממנו — רק דרך ה-API של התור (וקודי הכניסה, lib/crm/login-code.ts) */
export const SERVER_ONLY = ['aiJobFiles', 'aiQueue', 'aiSpend', 'loginCodes', 'vcEvents']
/** אוספים שהדפדפן קורא אבל לא כותב ישירות */
export const SERVER_WRITE = ['aiJobs', ...SERVER_ONLY]

/** המעבד חי = קרא לתור לאחרונה. החלון לפי קצב השגרה שהוא מדווח (כל 10 דק׳ / כל שעה): פי 2 + מרווח, לפחות 30 דק׳ */
export const aliveMs = (everyMin: number) => Math.max(30, 2 * (Number(everyMin) || 10) + 10) * 60e3
export const JOB_TIMEOUT_MS = 3 * 3600e3
const CLAIM_STALE_MS = 30 * 60e3

export type JobStatus = 'pending' | 'working' | 'done' | 'error' | 'cancelled'
export interface Turn { role: 'user' | 'assistant'; content: string }
export interface Apply { path: string; field: string }
export interface AiJob {
  id: string; status: JobStatus; turns: Turn[]; system?: string; modelTier: string; json: boolean
  images: number; apply?: Apply | null; clientId?: string | null; label?: string
  requestedBy: string; createdAt: string; claimedAt?: string; doneAt?: string; text?: string; error?: string
}

/** לאן מותר להחזיר תוצאה: רק שדה הניתוח של "הכר את הלקוח". שום דבר אחר לא נכתב מכאן בלי אדם. */
export function validApply(a: unknown): Apply | null {
  if (!a || typeof a !== 'object') return null
  const { path, field } = a as Record<string, unknown>
  const m = /^intakes\/([A-Za-z0-9_-]{1,120})$/.exec(String(path ?? ''))
  return m && field === 'ai' ? { path: String(path), field: 'ai' } : null
}

async function getDoc<T>(coll: string, id: string): Promise<T | null> {
  const [r] = await sql<{ data: T }[]>`select data from crm_docs where coll = ${coll} and doc_id = ${id} and deleted_at is null`
  return r?.data ?? null
}

export async function queueAlive(now = Date.now()): Promise<boolean> {
  const s = await getDoc<{ lastPoll?: string; everyMin?: number }>('aiQueue', 'status')
  return !!s?.lastPoll && now - Date.parse(s.lastPoll) < aliveMs(s.everyMin ?? 10)
}

export async function enqueue(s: CrmSession, req: { turns: Turn[]; system?: string; modelTier: string; json?: boolean; images: { media_type: string; data: string }[]; apply?: unknown; label?: string }): Promise<AiJob> {
  const id = randomUUID().replace(/-/g, '').slice(0, 20), apply = validApply(req.apply)
  const job: AiJob = {
    id, status: 'pending', turns: req.turns, ...(req.system ? { system: req.system } : {}), modelTier: req.modelTier, json: !!req.json,
    images: req.images.length, apply, clientId: apply ? apply.path.split('/')[1] : null, label: String(req.label ?? '').slice(0, 120),
    requestedBy: s.k, createdAt: new Date().toISOString(),
  }
  for (const [i, im] of req.images.entries()) await writeDoc(`aiJobFiles/${id}-${i}`, 'set', { jobId: id, n: i, media_type: im.media_type, data: im.data })
  await writeDoc(`aiJobs/${id}`, 'set', job)
  return job
}

export const jobOf = (id: string) => getDoc<AiJob>('aiJobs', id)

/** הבקשות שממתינות (וגם כאלה שנלקחו ונתקעו). כל קריאה = דופק: התור נחשב חי. */
export async function pendingJobs(now = Date.now(), everyMin = 10): Promise<AiJob[]> {
  await writeDoc('aiQueue/status', 'set', { lastPoll: new Date(now).toISOString(), everyMin: Math.min(24 * 60, Math.max(1, Math.round(everyMin) || 10)) })
  const rows = await sql<{ data: AiJob }[]>`
    select data from crm_docs where coll = 'aiJobs' and deleted_at is null and data->>'status' in ('pending', 'working')
    order by data->>'createdAt' limit 50`
  return rows.map((r) => r.data).filter((j) => {
    if (now - Date.parse(j.createdAt) > JOB_TIMEOUT_MS) return false
    return j.status === 'pending' || (j.claimedAt && now - Date.parse(j.claimedAt) > CLAIM_STALE_MS)
  })
}

export async function jobFiles(id: string): Promise<{ n: number; media_type: string; data: string }[]> {
  const rows = await sql<{ data: { n: number; media_type: string; data: string } }[]>`
    select data from crm_docs where coll = 'aiJobFiles' and deleted_at is null and data->>'jobId' = ${id} order by (data->>'n')::int`
  return rows.map((r) => r.data)
}

export async function claim(id: string): Promise<AiJob | null> {
  const j = await jobOf(id)
  if (!j || !['pending', 'working'].includes(j.status)) return null
  await writeDoc(`aiJobs/${id}`, 'update', { status: 'working', claimedAt: new Date().toISOString() })
  return { ...j, status: 'working' }
}

/** התשובה חוזרת: לבקשה, ואם ביקשו — לתיק וליומן הלקוח. התמונות נמחקות (soft delete) — לא נשארות בשרת. */
export async function complete(id: string, text: string): Promise<AiJob | null> {
  const j = await jobOf(id)
  if (!j || ['done', 'cancelled'].includes(j.status)) return null
  const at = new Date().toISOString()
  await writeDoc(`aiJobs/${id}`, 'update', { status: 'done', text, doneAt: at })
  const apply = validApply(j.apply)
  if (apply) {
    await writeDoc(apply.path, 'update', { [apply.field]: { at, text, by: 'claude', jobId: id, requestedBy: j.requestedBy }, updatedAt: at })
    const cid = apply.path.split('/')[1]!
    const c = await getDoc<{ log?: unknown[] }>('clients', cid)
    if (c) await writeDoc(`clients/${cid}`, 'update', { log: [{ at, text: 'Claude: ' + (j.label || 'ניתוח') + ' — נשמר בהכר את הלקוח', auto: true, by: 'claude' }, ...(c.log ?? [])].slice(0, 300), updatedAt: at })
  }
  await dropFiles(id)
  return { ...j, status: 'done', text, doneAt: at }
}

export async function fail(id: string, error: string, status: 'error' | 'cancelled' = 'error'): Promise<void> {
  const j = await jobOf(id)
  if (!j || ['done', 'cancelled'].includes(j.status)) return
  await writeDoc(`aiJobs/${id}`, 'update', { status, error: error.slice(0, 500), doneAt: new Date().toISOString() })
  await dropFiles(id)
}

async function dropFiles(id: string) {
  const files = await sql<{ doc_id: string }[]>`select doc_id from crm_docs where coll = 'aiJobFiles' and deleted_at is null and data->>'jobId' = ${id}`
  // מחיקה רכה בלבד (הנחיה 4) — לכן קודם מרוקנים את התמונה עצמה, כדי שלא תישאר בשרת
  for (const f of files) { await writeDoc(`aiJobFiles/${f.doc_id}`, 'update', { data: null, droppedAt: new Date().toISOString() }); await writeDoc(`aiJobFiles/${f.doc_id}`, 'delete', null) }
}
