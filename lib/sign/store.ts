/**
 * מערכת החתימות — הצד שמדבר עם ה-DB, ה-PDF, הדרייב וה-CRM. הכללים עצמם ב-lib/rules/sign.ts.
 *
 * מעטפה (sign_envelopes, 018) = מסמך אחד לחתימה. לכל חותם שורה ב-sign_requests עם קישור אישי.
 *
 *   createEnvelope — צילום נוסח (לכל חותם, או אחד משותף) + SHA-256, טוקן אקראי לכל חותם (נשמר רק
 *                    ה-hash), הזמנה במייל דרך outbox ושליחה מיידית (הנחיה 16). וואטסאפ — הקישור חוזר
 *                    לדף ונשלח מהטלפון של דן.
 *   markOpened     — הלקוח פתח (דרך הדף עצמו, לא תצוגה מקדימה של קישור בוואטסאפ/מייל).
 *   sendOtp/verifyOtp — קוד חד-פעמי במייל, כשהמסמך דורש.
 *   submitRequest  — החותם חתם: בדיקה, עדכון מותנה (רק אם עוד פתוח, בתוקף ומאומת) → נעול ב-DB.
 *   finalizeEnvelope — כשכל החותמים חתמו: PDF אחד (stored_files) → דרייב → כרטיס הלקוח → עותק לכל
 *                    חותם ולדן. נכשל? הכרטיס מציג "צור PDF שוב".
 *   remind         — קישור חדש לחותם שלא חתם (הישן מפסיק לעבוד) + מייל.
 *
 * טפסים מ-PDF (019): במקום נוסח מוקלד — קובץ PDF (stored_files) ושדות שהוצבו עליו לכל לווה.
 * הטביעה של כל חותם = SHA-256 של הקובץ + השדות שלו. בסיום החתימות נכתבות על ה-PDF המקורי
 * (lib/sign/pdf.ts) ועמוד התיעוד מתווסף בסוף. נמען יכול להיות גם מתעניין (ליד).
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { sql } from '@/lib/db'
import {
  canResendOtp, expiryFrom, groupByDocument, maskEmail, OTP_MAX_ATTEMPTS, OTP_TTL_MS, otpState, renderAgreement, signState,
  SIGN_CATEGORIES, validateSigners, validateSubmission, type FieldValue, type SignCategory, type SignerInput, type SignState, type Submission,
} from '@/lib/rules/sign'
import { writeDoc } from '@/lib/crm/store'
import { googleAccessToken } from '@/lib/google/store'
import { ensureChildFolder, uploadFile } from '@/lib/google/drive'
import { internalBaseUrl, renderPdf } from '@/lib/pdf'
import { readStoredFile, storeFile, storeLocalFile } from '@/lib/files'
import { readFile } from 'node:fs/promises'
import { checkSignerValues, fieldsOf, validatePdfFields, type PageSize, type PdfField } from '@/lib/rules/sign-pdf'
import { appendPdf, readPageSizes, stampPdf } from './pdf'
import { flushOutbox } from '@/lib/jobs/outbox'

export const AGREEMENTS_FOLDER = 'הסכמי התקשרות'
const SIGNED_FOLDER = 'מסמכים חתומים'
const folderFor = (category: string) => (category === 'agreement' ? AGREEMENTS_FOLDER : SIGNED_FOLDER)

export interface SignRow {
  id: string; envelope_id: string | null; client_doc: string; client_name: string; division: 'finance' | 'realestate'; title: string; body_html: string; doc_hash: string
  fields: Record<string, FieldValue>; send_email: string | null; send_phone: string | null; status: 'sent' | 'opened' | 'signed' | 'cancelled'
  expires_at: string; opened_at: string | null; signed_at: string | null; signer_name: string | null; signer_id_number: string | null
  signature_png: string | null; signer_ip: string | null; signer_ua: string | null; pdf_path: string | null; drive_file_id: string | null; drive_url: string | null
  finalize_error: string | null; created_at: string; deleted_at: string | null
  signer_label: string | null; signer_order: number; require_otp: boolean; otp_hash: string | null; otp_expires_at: string | null; otp_attempts: number
  otp_sent_at: string | null; otp_verified_at: string | null; reminders_sent: number; last_reminder_at: string | null
  field_values: Record<string, string>
}

export interface EnvelopeRow {
  id: string; client_doc: string; client_name: string; division: 'finance' | 'realestate'; title: string; category: SignCategory
  template_key: string | null; lender: string | null; status: 'sent' | 'completed' | 'cancelled'; completed_at: string | null
  pdf_file_id: string | null; drive_file_id: string | null; drive_url: string | null; finalize_error: string | null; created_at: string
  source_file_id: string | null; pdf_fields: PdfField[] | null; page_sizes: PageSize[] | null; template_id: string | null; recipient_kind: 'client' | 'lead'
}

/** איפה נרשם היומן ב-CRM: כרטיס הלקוח או הליד. */
const collOf = (kind: string | null | undefined) => (kind === 'lead' ? 'leads' : 'clients')
async function kindOfRow(row: SignRow): Promise<'client' | 'lead'> {
  if (!row.envelope_id) return 'client'
  const [e] = await sql<{ k: 'client' | 'lead' }[]>`select recipient_kind as k from sign_envelopes where id = ${row.envelope_id}`
  return e?.k ?? 'client'
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const newToken = () => randomBytes(24).toString('base64url')

/** כתובת ציבורית לקישורים שיוצאים ללקוח. */
export function publicBaseUrl(fallback?: string): string {
  return (process.env.APP_BASE_URL || fallback || internalBaseUrl()).replace(/\/+$/, '')
}

/** חתימה על מזהה — לעמוד ההדפסה הפנימי (ממנו נוצר ה-PDF), בלי לחשוף טוקן של חותם. */
export function printKey(id: string): string {
  const secret = process.env.SIGN_SECRET || process.env.APP_PASSWORD
    || (process.env.NODE_ENV === 'production' ? null : process.env.DATABASE_URL || 'harel-dev')
  if (!secret) throw new Error('חסר SIGN_SECRET (או APP_PASSWORD) — בלעדיו אין מפתח לעמוד ההדפסה')
  return createHmac('sha256', secret).update('sign-print:' + id).digest('hex').slice(0, 32)
}
export function checkPrintKey(id: string, key: string | null | undefined): boolean {
  let expected: string
  try { expected = printKey(id) } catch { return false }
  const a = Buffer.from(expected), b = Buffer.from(String(key ?? ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ── יצירה ──────────────────────────────────────────────────────────────── */

export interface EnvelopeInput {
  clientDoc: string; clientName: string; division: 'finance' | 'realestate'; title: string; template: string
  category?: SignCategory; templateKey?: string | null; lender?: string | null
  fields: Record<string, FieldValue>; signers: SignerInput[]
  /** נוסח נפרד לכל חותם (השדות של החותם ממולאים בנוסח שלו) — "גרסה לכל לווה" */
  perSigner?: boolean
  expiresDays?: number | null; allowMissing?: boolean
  /** טופס PDF: הקובץ (stored_files), השדות לכל לווה ומידות העמודים. אז template לא בשימוש. */
  pdf?: { fileId: string; fields: PdfField[]; templateId?: string | null } | null
  recipientKind?: 'client' | 'lead'
}
export interface SignerLink { id: string; label: string; url: string; email: string | null; phone: string | null; emailQueued: boolean; requireOtp: boolean }

export async function createEnvelope(input: EnvelopeInput, now: Date, baseUrl?: string):
  Promise<{ envelopeId: string; links: SignerLink[]; missing: string[] } | { error: string; missing: string[] }> {
  const errs = validateSigners(input.signers)
  if (errs.length) return { error: errs.join(' · '), missing: [] }
  const category: SignCategory = input.category && input.category in SIGN_CATEGORIES ? input.category : 'agreement'
  const kind = input.recipientKind === 'lead' ? 'lead' : 'client'
  let bodies: { html: string; missing: string[]; hash?: string }[]
  let pdf: { fileId: string; fields: PdfField[]; pages: PageSize[]; templateId: string | null } | null = null
  if (input.pdf) {
    const f = await readStoredFile(input.pdf.fileId)
    if (!f || !String(f.mime).includes('pdf')) return { error: 'קובץ ה-PDF לא נמצא — העלו שוב', missing: [] }
    const pages = await readPageSizes(f.bytes).catch(() => null)
    if (!pages) return { error: 'קובץ ה-PDF לא נקרא', missing: [] }
    const errs = validatePdfFields(input.pdf.fields, pages.length, input.signers.length)
    if (errs.length) return { error: errs.join(' · '), missing: [] }
    pdf = { fileId: input.pdf.fileId, fields: input.pdf.fields, pages, templateId: input.pdf.templateId ?? null }
    const fileHash = sha256(f.bytes)
    bodies = input.signers.map((_s, i) => {
      const mine = fieldsOf(pdf!.fields, i + 1)
      return { html: `<p>מסמך PDF: <b>${escHtml(input.title)}</b> · ${pages.length} עמודים · ${mine.length} שדות לחותם הזה.</p>`, missing: [], hash: sha256(fileHash + ':' + JSON.stringify(mine)) }
    })
  } else {
    bodies = input.signers.map((s) => renderAgreement(input.template, input.perSigner
      ? { ...input.fields, ...(s.fields ?? {}), signer_name: s.name ?? '', signer_label: s.label }
      : input.fields))
  }
  const missing = [...new Set(bodies.flatMap((b) => b.missing))]
  if (!bodies[0]?.html.trim()) return { error: 'הנוסח ריק', missing }
  if (missing.length && !input.allowMissing) return { error: 'חסרים שדות בנוסח: ' + missing.join(', '), missing }

  const tokens = input.signers.map(() => newToken())
  const expires = expiryFrom(now, input.expiresDays)
  const res = await sql.begin(async (tx) => {
    const [env] = await tx<{ id: string }[]>`
      insert into sign_envelopes (client_doc, client_name, division, title, category, template_key, lender, recipient_kind, source_file_id, pdf_fields, page_sizes, template_id)
      values (${input.clientDoc}, ${input.clientName}, ${input.division}, ${input.title}, ${category}, ${input.templateKey ?? null}, ${input.lender ?? null}, ${kind},
              ${pdf?.fileId ?? null}, ${pdf ? tx.json(pdf.fields as never) : null}, ${pdf ? tx.json(pdf.pages as never) : null}, ${pdf?.templateId ?? null})
      returning id`
    const ids: string[] = []
    for (const [i, s] of input.signers.entries()) {
      const html = bodies[i]!.html
      const [row] = await tx<{ id: string }[]>`
        insert into sign_requests (envelope_id, token_hash, client_doc, client_name, division, title, body_html, doc_hash, fields, send_email, send_phone,
                                   expires_at, signer_label, signer_order, require_otp)
        values (${env!.id}, ${sha256(tokens[i]!)}, ${input.clientDoc}, ${s.name || input.clientName}, ${input.division}, ${input.title}, ${html}, ${bodies[i]!.hash ?? sha256(html)},
                ${tx.json((input.perSigner ? { ...input.fields, ...(s.fields ?? {}) } : input.fields) as never)}, ${cleanEmail(s.email)}, ${cleanPhone(s.phone)},
                ${expires}, ${s.label}, ${i + 1}, ${Boolean(s.requireOtp)})
        returning id`
      ids.push(row!.id)
    }
    return { envelopeId: env!.id, ids }
  })

  const base = publicBaseUrl(baseUrl)
  const links: SignerLink[] = []
  for (const [i, s] of input.signers.entries()) {
    const url = `${base}/s/${tokens[i]}`, email = cleanEmail(s.email)
    if (email) await sql`insert into outbox (channel, target, subject, body, dedup_key)
      values ('email', ${email}, ${input.title + ' — לחתימה'}, ${inviteHtml(s.name || input.clientName, input.title, url, input.signers.length)}, ${'sign-invite:' + res.ids[i]})
      on conflict (dedup_key) where dedup_key is not null and deleted_at is null do nothing`
    links.push({ id: res.ids[i]!, label: s.label, url, email, phone: cleanPhone(s.phone), emailQueued: Boolean(email), requireOtp: Boolean(s.requireOtp) })
  }
  await crmLog(input.clientDoc, `נשלח לחתימה: ${input.title}` + (input.signers.length > 1 ? ` · ${input.signers.length} חותמים (${input.signers.map((s) => s.label).join(', ')})` : '') +
    (links.some((l) => l.email) ? ' · במייל' : ''), now, category === 'agreement' && kind === 'client' ? { agreementSignId: res.envelopeId, agreementStatus: 'sent' } : {}, collOf(kind)).catch(() => {})
  await flushNow()
  return { envelopeId: res.envelopeId, links, missing }
}

/** תאימות: בקשה לחותם יחיד (הכרטיס הישן / סקריפטים). */
export async function createRequest(input: { clientDoc: string; clientName: string; division: 'finance' | 'realestate'; title: string; template: string; fields: Record<string, FieldValue>; email?: string | null; phone?: string | null; expiresDays?: number | null; allowMissing?: boolean }, now: Date, baseUrl?: string) {
  const r = await createEnvelope({ ...input, signers: [{ label: 'הלקוח', name: input.clientName, email: input.email, phone: input.phone }] }, now, baseUrl)
  if ('error' in r) return r
  const l = r.links[0]!
  return { id: l.id, envelopeId: r.envelopeId, url: l.url, missing: r.missing, emailQueued: l.emailQueued }
}

/* ── קריאה ──────────────────────────────────────────────────────────────── */

export async function byToken(token: string): Promise<SignRow | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const [r] = await sql<SignRow[]>`select * from sign_requests where token_hash = ${sha256(token)}`
  return r ?? null
}
export async function byId(id: string): Promise<SignRow | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const [r] = await sql<SignRow[]>`select * from sign_requests where id = ${id}`
  return r ?? null
}
export async function envelopeById(id: string): Promise<EnvelopeRow | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const [e] = await sql<EnvelopeRow[]>`select * from sign_envelopes where id = ${id} and deleted_at is null`
  if (e) return e
  // מזהה של חותם → המעטפה שלו
  const [r] = await sql<EnvelopeRow[]>`select e.* from sign_envelopes e join sign_requests r on r.envelope_id = e.id where r.id = ${id} and e.deleted_at is null`
  return r ?? null
}
export async function envelopeSigners(envelopeId: string): Promise<SignRow[]> {
  return sql<SignRow[]>`select * from sign_requests where envelope_id = ${envelopeId} and deleted_at is null order by signer_order, created_at`
}

export interface OverviewRow {
  id: string; client_doc: string; client_name: string; division: string; title: string; category: string; template_key: string | null; lender: string | null
  created_at: string; completed_at: string | null; drive_url: string | null; pdf_file_id: string | null; finalize_error: string | null
  signers: number; signed: number; waiting: number; expired: number; opened: number; last_activity: string | null; next_expiry: string | null
  people: { id: string; label: string | null; order: number; status: string; expired: boolean; email: string | null; phone: string | null; signer: string | null; opened_at: string | null; signed_at: string | null; expires_at: string; require_otp: boolean; otp_ok: boolean; reminders: number; last_reminder_at: string | null }[]
  state: 'completed' | 'cancelled' | 'partial' | 'opened' | 'expired' | 'sent'
  recipient_kind: 'client' | 'lead'; template_id: string | null; source_file_id: string | null; pages: number
}

/** "מסמכים לחתימה" (v_sign_overview): לכל המערכת, או ללקוח אחד. */
export async function listEnvelopes(opts: { client?: string | null; state?: string | null; division?: string | null; limit?: number } = {}): Promise<OverviewRow[]> {
  return sql<OverviewRow[]>`
    select * from v_sign_overview
    where (${opts.client ?? null}::text is null or client_doc = ${opts.client ?? null})
      and (${opts.state ?? null}::text is null or state = ${opts.state ?? null})
      and (${opts.division ?? null}::text is null or division = ${opts.division ?? null})
    order by coalesce(last_activity, created_at) desc
    limit ${Math.min(Math.max(opts.limit ?? 200, 1), 1000)}`
}
export async function envelopeCounts(division?: string | null): Promise<Record<string, number>> {
  const rows = await sql<{ state: string; n: number }[]>`
    select state, count(*)::int as n from v_sign_overview where (${division ?? null}::text is null or division = ${division ?? null}) group by state`
  return Object.fromEntries(rows.map((r) => [r.state, r.n]))
}
export const listForClient = (clientDoc: string) => listEnvelopes({ client: clientDoc, limit: 30 })

/* ── הצד של החותם ───────────────────────────────────────────────────────── */

/** הקישור נפתח — רק קריאה. סימון "נפתח" נעשה מהדף עצמו (markOpened), לא מכל GET. */
export async function openRequest(token: string, now: Date): Promise<{ row: SignRow; state: SignState; envelope: EnvelopeRow | null; total: number } | null> {
  const row = await byToken(token)
  if (!row) return null
  const envelope = row.envelope_id ? await envelopeById(row.envelope_id) : null
  const [t] = row.envelope_id ? await sql<{ n: number }[]>`select count(*)::int as n from sign_requests where envelope_id = ${row.envelope_id} and deleted_at is null and status <> 'cancelled'` : [{ n: 1 }]
  return { row, state: signState(row, now), envelope, total: t?.n ?? 1 }
}

/** הדף נפתח בדפדפן של החותם (JS) — לא תצוגה מקדימה של הקישור בוואטסאפ או במייל. */
export async function markOpened(token: string, now: Date): Promise<boolean> {
  const row = await byToken(token)
  if (!row || signState(row, now) !== 'open' || row.status !== 'sent') return false
  const res = await sql`update sign_requests set status = 'opened', opened_at = ${now} where id = ${row.id} and status = 'sent'`
  if (res.count) await crmLog(row.client_doc, `${row.signer_label && row.signer_label !== 'הלקוח' ? row.signer_label + ' (' + row.client_name + ')' : 'הלקוח'} פתח/ה את "${row.title}" לחתימה`, now, {}, collOf(await kindOfRow(row))).catch(() => {})
  return res.count > 0
}

const otpHashOf = (id: string, code: string) => sha256(`otp:${id}:${code}`)

export async function sendOtp(token: string, now: Date): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const row = await byToken(token)
  if (!row || signState(row, now) !== 'open') return { ok: false, error: 'הקישור לא פעיל' }
  if (!row.require_otp) return { ok: false, error: 'לא נדרש קוד למסמך הזה' }
  if (!row.send_email) return { ok: false, error: 'אין מייל לשליחת הקוד — נא לפנות אלינו' }
  if (row.otp_verified_at) return { ok: true, to: maskEmail(row.send_email) }
  if (!canResendOtp(row.otp_sent_at, now)) return { ok: false, error: 'קוד נשלח לפני פחות מדקה — בדקו את המייל (גם בספאם)' }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await sql`update sign_requests set otp_hash = ${otpHashOf(row.id, code)}, otp_expires_at = ${new Date(now.getTime() + OTP_TTL_MS)}, otp_attempts = 0, otp_sent_at = ${now}
            where id = ${row.id} and otp_verified_at is null`
  await sql`insert into outbox (channel, target, subject, body, dedup_key)
    values ('email', ${row.send_email}, ${'קוד אימות לחתימה: ' + code},
      ${'<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#111827"><p>קוד האימות לחתימה על <b>' + escHtml(row.title) + '</b>:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">' + code + '</p><p style="color:#6B7280;font-size:13px">הקוד בתוקף 10 דקות. אם לא ביקשת — אפשר להתעלם.</p><p>הר-אל</p></div>'},
      ${'sign-otp:' + row.id + ':' + now.getTime()})`
  await flushNow()
  return { ok: true, to: maskEmail(row.send_email) }
}

export async function verifyOtp(token: string, code: string, now: Date): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await byToken(token)
  if (!row || signState(row, now) !== 'open') return { ok: false, error: 'הקישור לא פעיל' }
  const st = otpState(row, now)
  if (st === 'not_required' || st === 'verified') return { ok: true }
  if (st === 'need_send') return { ok: false, error: 'הקוד פג — שלחו קוד חדש' }
  if (st === 'locked') return { ok: false, error: 'יותר מדי ניסיונות — שלחו קוד חדש' }
  // ניסיון נספר לפני הבדיקה (אטומי) — אי אפשר לנחש במקביל
  const [r] = await sql<{ otp_hash: string }[]>`
    update sign_requests set otp_attempts = otp_attempts + 1
    where id = ${row.id} and otp_verified_at is null and otp_attempts < ${OTP_MAX_ATTEMPTS} and otp_expires_at > ${now}
    returning otp_hash`
  if (!r) return { ok: false, error: 'יותר מדי ניסיונות — שלחו קוד חדש' }
  const a = Buffer.from(otpHashOf(row.id, String(code).replace(/\D/g, ''))), b = Buffer.from(r.otp_hash)
  if (!(a.length === b.length && timingSafeEqual(a, b))) return { ok: false, error: 'קוד שגוי' }
  await sql`update sign_requests set otp_verified_at = ${now} where id = ${row.id} and otp_verified_at is null`
  return { ok: true }
}

export async function submitRequest(token: string, s: Partial<Submission>, meta: { ip: string | null; ua: string | null }, now: Date):
  Promise<{ ok: true; id: string; envelopeId: string | null } | { ok: false; errors: string[]; state?: SignState }> {
  const row = await byToken(token)
  if (!row) return { ok: false, errors: ['הקישור לא נמצא'] }
  const state = signState(row, now)
  if (state !== 'open') return { ok: false, errors: [state === 'signed' ? 'המסמך כבר נחתם' : state === 'expired' ? 'תוקף הקישור פג — בקשו קישור חדש' : 'הקישור בוטל'], state }
  if (row.require_otp && !row.otp_verified_at) return { ok: false, errors: ['נדרש קוד אימות מהמייל לפני החתימה'] }
  const errors = validateSubmission(s)
  // טופס PDF: שדות הטקסט / הסימון של החותם הזה
  let values: Record<string, string> = {}
  if (row.envelope_id) {
    const [e] = await sql<{ pdf_fields: PdfField[] | null }[]>`select pdf_fields from sign_envelopes where id = ${row.envelope_id}`
    if (e?.pdf_fields) { const c = checkSignerValues(e.pdf_fields, row.signer_order, (s as { values?: unknown }).values); values = c.values; errors.push(...c.errors) }
  }
  if (errors.length) return { ok: false, errors }
  const id = String(s.idNumber).replace(/\D/g, '').padStart(9, '0')
  const res = await sql`
    update sign_requests set status = 'signed', signed_at = ${now}, signer_name = ${String(s.name).trim()}, signer_id_number = ${id},
      signature_png = ${String(s.signature)}, signer_ip = ${meta.ip}, signer_ua = ${(meta.ua ?? '').slice(0, 400)}, field_values = ${sql.json(values as never)},
      opened_at = coalesce(opened_at, ${now})
    where id = ${row.id} and status in ('sent', 'opened') and deleted_at is null and expires_at > ${now}
      and (not require_otp or otp_verified_at is not null)`
  if (!res.count) return { ok: false, errors: ['המסמך כבר נחתם או שהקישור לא בתוקף'] }
  return { ok: true, id: row.id, envelopeId: row.envelope_id }
}

/* ── סיום: PDF → דרייב → כרטיס → עותקים ─────────────────────────────────── */

/**
 * אחרי כל חתימה. כל עוד חסר חותם — רישום בכרטיס ("חתם/ה 1 מתוך 2") והודעה לדן. כשכולם חתמו —
 * PDF אחד עם כל החתימות, לדרייב, לכרטיס, ועותק לכל חותם. אפשר להריץ שוב מהכרטיס אם נכשל.
 */
export async function finalizeEnvelope(id: string, now: Date, justSigned?: string | null): Promise<{ ok: boolean; complete: boolean; driveUrl?: string; error?: string }> {
  const env = await envelopeById(id)
  if (!env) return { ok: false, complete: false, error: 'לא נמצא' }
  const rows = (await envelopeSigners(env.id)).filter((r) => r.status !== 'cancelled')
  const signed = rows.filter((r) => r.status === 'signed')
  if (!rows.length) return { ok: false, complete: false, error: 'אין חותמים' }

  const coll = collOf(env.recipient_kind)
  if (signed.length < rows.length) {
    const who = rows.find((r) => r.id === justSigned)
    if (who) {
      await crmLog(env.client_doc, `${who.signer_name} חתם/ה על "${env.title}" (${signed.length} מתוך ${rows.length})`, now, {}, coll).catch(() => {})
      await notifyOwner(env, `${who.signer_name} חתם/ה — ${signed.length} מתוך ${rows.length}`, `sign-partial:${who.id}`, null)
    }
    return { ok: true, complete: false }
  }

  // מהמסד מגיע Date (timestamptz) — לא מחרוזת
  const lastSigned = signed.map((r) => new Date(r.signed_at!).toISOString()).sort().at(-1)!
  if (env.status !== 'completed') await sql`update sign_envelopes set status = 'completed', completed_at = ${lastSigned} where id = ${env.id} and status = 'sent'`
  const fileName = `${env.title} — ${safeName(env.client_name)} — ${lastSigned.slice(0, 10)} — ${env.id.slice(0, 8)}.pdf`

  // 1. PDF — נשמר במסד (stored_files), כדי שהמייל והדרייב יעבדו גם בשרת מנוהל
  let fileId = env.pdf_file_id
  if (!fileId) {
    try {
      if (env.source_file_id && env.pdf_fields) {
        // טופס PDF: החתימות על המסמך המקורי + עמוד התיעוד בסוף
        const src = await readStoredFile(env.source_file_id)
        if (!src) throw new Error('המסמך המקורי לא נמצא במסד')
        const stamped = await stampPdf(src.bytes, env.pdf_fields, signed.map((r) => ({
          order: r.signer_order, name: String(r.signer_name ?? ''), idNumber: String(r.signer_id_number ?? ''), signedAt: new Date(r.signed_at!),
          signaturePng: String(r.signature_png ?? ''), values: r.field_values ?? {},
        })))
        const auditPath = await renderPdf(`${internalBaseUrl()}/s/print/${env.id}?k=${printKey(env.id)}&audit=1`, `sign-${env.id}-audit.pdf`)
        fileId = await storeFile(await appendPdf(stamped, await readFile(auditPath)), fileName, 'application/pdf', 'sign')
      } else {
        const path = await renderPdf(`${internalBaseUrl()}/s/print/${env.id}?k=${printKey(env.id)}`, `sign-${env.id}.pdf`)
        fileId = await storeLocalFile(path, fileName, 'application/pdf', 'sign')
      }
      await sql`update sign_envelopes set pdf_file_id = ${fileId} where id = ${env.id}`
    } catch (e) {
      const msg = 'יצירת ה-PDF נכשלה: ' + (e as Error).message
      await sql`update sign_envelopes set finalize_error = ${msg.slice(0, 500)} where id = ${env.id}`
      await crmLog(env.client_doc, `"${env.title}" נחתם ע"י כל החותמים — ${msg.slice(0, 160)}`, now, agreementPatch(env, lastSigned, null), coll).catch(() => {})
      return { ok: false, complete: true, error: msg }
    }
  }

  // 2. דרייב — כישלון כאן לא עוצר את העותקים במייל
  let driveUrl = env.drive_url, driveErr: string | null = null
  if (!env.drive_file_id && env.recipient_kind !== 'lead') {
    try {
      const folder = await clientDriveFolder(env.client_doc)
      if (!folder) throw new Error('ללקוח אין תיקייה בדרייב — פתח תיקייה בכרטיס ולחץ "צור PDF שוב"')
      const f = await readStoredFile(fileId)
      if (!f) throw new Error('ה-PDF לא נמצא במסד')
      const token = await googleAccessToken()
      const sub = await ensureChildFolder(token, folder, folderFor(env.category))
      const up = await uploadFile(token, sub, fileName, 'application/pdf', f.bytes)
      await sql`update sign_envelopes set drive_file_id = ${up.id}, drive_url = ${up.webViewLink} where id = ${env.id}`
      driveUrl = up.webViewLink
    } catch (e) { driveErr = 'לא נשמר בדרייב: ' + (e as Error).message }
  }
  await sql`update sign_envelopes set finalize_error = ${driveErr ? driveErr.slice(0, 500) : null} where id = ${env.id}`

  // 3. כרטיס הלקוח + עותק לכל חותם ולדן (dedup — הרצה חוזרת לא שולחת שוב)
  await crmLog(env.client_doc, `"${env.title}" נחתם ע"י ${signed.map((r) => r.signer_name).join(', ')}` + (driveUrl ? ` · נשמר בדרייב (${folderFor(env.category)})` : driveErr ? ' — ' + driveErr.slice(0, 140) : env.recipient_kind === 'lead' ? ' · נשמר במערכת (מתעניין — אין תיקייה בדרייב)' : ''), now,
    agreementPatch(env, lastSigned, driveUrl ?? null), coll).catch(() => {})
  const payload = { fileId, fileName }
  await notifyOwner(env, `נחתם ע"י כל החותמים (${signed.length})`, `sign-done-owner:${env.id}`, payload, driveUrl ?? null)
  for (const r of signed) if (r.send_email) await sql`insert into outbox (channel, target, subject, body, payload, dedup_key)
    values ('email', ${r.send_email}, ${'עותק חתום — ' + env.title},
      ${'<div dir="rtl" style="font-family:Arial,sans-serif">שלום ' + escHtml(String(r.signer_name ?? '').split(/\s+/)[0] ?? '') + ', מצורף העותק החתום של ' + escHtml(env.title) + '. תודה, הר-אל</div>'},
      ${sql.json(payload as never)}, ${'sign-done-signer:' + r.id})
    on conflict (dedup_key) where dedup_key is not null and deleted_at is null do nothing`
  await flushNow()
  return driveErr ? { ok: false, complete: true, error: driveErr } : { ok: true, complete: true, driveUrl: driveUrl ?? undefined }
}

/** תאימות לשם הישן. */
export const finalize = (id: string, now: Date) => finalizeEnvelope(id, now)

/* ── פעולות הצוות ───────────────────────────────────────────────────────── */

/** ביטול מסמך שעוד לא נחתם ע"י כולם (מזהה מעטפה או חותם). */
export async function cancelEnvelope(id: string, now: Date): Promise<boolean> {
  const env = await envelopeById(id)
  if (!env || env.status !== 'sent') return false
  await sql.begin(async (tx) => {
    await tx`update sign_requests set status = 'cancelled' where envelope_id = ${env.id} and status in ('sent', 'opened')`
    await tx`update sign_envelopes set status = 'cancelled' where id = ${env.id} and status = 'sent'`
  })
  await crmLog(env.client_doc, 'בוטל מסמך לחתימה: ' + env.title, now, env.category === 'agreement' && env.recipient_kind === 'client' ? { agreementStatus: 'cancelled' } : {}, collOf(env.recipient_kind)).catch(() => {})
  return true
}
export const cancelRequest = cancelEnvelope

/** "מחיקת המסמך" (מפרט WISE): הסתרה בלבד. מסמך שעוד פתוח מבוטל קודם (הקישורים מפסיקים לעבוד); מסמך חתום נשאר במסד ובדרייב. */
export async function deleteEnvelope(id: string, now: Date): Promise<boolean> {
  const env = await envelopeById(id)
  if (!env) return false
  await sql.begin(async (tx) => {
    await tx`update sign_requests set status = 'cancelled' where envelope_id = ${env.id} and status in ('sent', 'opened')`
    if (env.status === 'sent') await tx`update sign_envelopes set status = 'cancelled' where id = ${env.id} and status = 'sent'`
    await tx`update sign_requests set deleted_at = ${now} where envelope_id = ${env.id} and deleted_at is null`
    await tx`update sign_envelopes set deleted_at = ${now} where id = ${env.id} and deleted_at is null`
  })
  await crmLog(env.client_doc, 'נמחק מרשימת המסמכים לחתימה: ' + env.title + (env.status === 'completed' ? ' (העותק החתום נשאר שמור)' : ''), now, {}, collOf(env.recipient_kind)).catch(() => {})
  return true
}

/** תזכורת לחותם שלא חתם: קישור חדש (הקודם מפסיק לעבוד), תוקף מוארך ל-7 ימים לפחות, ומייל. */
export async function remind(requestId: string, now: Date, baseUrl?: string): Promise<{ ok: true; url: string; emailQueued: boolean } | { ok: false; error: string }> {
  const row = await byId(requestId)
  if (!row || !['sent', 'opened'].includes(row.status) || row.deleted_at) return { ok: false, error: 'החותם כבר חתם או שהמסמך בוטל' }
  const token = newToken()
  const minExpiry = new Date(now.getTime() + 7 * 86_400_000)
  const [u] = await sql<{ reminders_sent: number }[]>`
    update sign_requests set token_hash = ${sha256(token)}, reminders_sent = reminders_sent + 1, last_reminder_at = ${now},
      expires_at = greatest(expires_at, ${minExpiry})
    where id = ${row.id} and status in ('sent', 'opened') returning reminders_sent`
  if (!u) return { ok: false, error: 'החותם כבר חתם' }
  const url = `${publicBaseUrl(baseUrl)}/s/${token}`
  if (row.send_email) await sql`insert into outbox (channel, target, subject, body, dedup_key)
    values ('email', ${row.send_email}, ${'תזכורת: ' + row.title + ' — לחתימה'}, ${inviteHtml(row.client_name, row.title, url, 1, true)}, ${'sign-remind:' + row.id + ':' + u.reminders_sent})
    on conflict (dedup_key) where dedup_key is not null and deleted_at is null do nothing`
  await crmLog(row.client_doc, `נשלחה תזכורת לחתימה (${row.signer_label ?? 'הלקוח'}): ${row.title}`, now, {}, collOf(await kindOfRow(row))).catch(() => {})
  await flushNow()
  return { ok: true, url, emailQueued: Boolean(row.send_email) }
}

/* ── עזר ────────────────────────────────────────────────────────────────── */

async function flushNow() { await flushOutbox().catch((e) => console.error('outbox:', (e as Error).message)) }

function cleanEmail(e: string | null | undefined): string | null {
  const v = String(e ?? '').trim().toLowerCase()
  return /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(v) ? v : null
}
const cleanPhone = (p: string | null | undefined) => String(p ?? '').replace(/[^\d+]/g, '') || null
const safeName = (s: string) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)
const escHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function inviteHtml(name: string, title: string, url: string, signers: number, reminder = false): string {
  return '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">' +
    `<p>שלום ${escHtml(String(name).split(/\s+/)[0] ?? '')},</p><p>${reminder ? 'תזכורת: ' : ''}מצורף קישור אישי לקריאה וחתימה על <b>${escHtml(title)}</b>.</p>` +
    (signers > 1 ? `<p style="color:#6B7280;font-size:13px">על המסמך חותמים ${signers} אנשים — לכל אחד קישור משלו.</p>` : '') +
    `<p><a href="${escHtml(url)}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">לקריאה וחתימה</a></p>` +
    `<p style="color:#6B7280;font-size:13px">החתימה נעשית בטלפון או במחשב, בלי הרשמה. אחרי שכולם חותמים יישלח אליך עותק חתום.${reminder ? ' הקישור הקודם כבר לא פעיל.' : ''}</p><p>הר-אל</p></div>`
}

const agreementPatch = (env: EnvelopeRow, signedAt: string, url: string | null) => env.category === 'agreement' && env.recipient_kind !== 'lead'
  ? { agreementStatus: 'signed', agreementSignedAt: signedAt, agreementSignId: env.id, ...(url ? { agreementPdfUrl: url } : {}) } : {}

async function clientDriveFolder(clientDoc: string): Promise<string | null> {
  const [r] = await sql<{ folder: string | null }[]>`select data->>'driveFolder' as folder from crm_docs where coll = 'clients' and doc_id = ${clientDoc} and deleted_at is null`
  return r?.folder && /^[A-Za-z0-9_-]{10,}$/.test(r.folder) ? r.folder : null
}

/** רישום ביומן ב-CRM (clients/<id> או leads/<id>), ועדכון שדות הסטטוס בכרטיס. */
export async function crmLog(clientDoc: string, text: string, now: Date, patch: Record<string, unknown> = {}, coll: 'clients' | 'leads' = 'clients'): Promise<void> {
  const [r] = await sql<{ data: { log?: unknown[] } }[]>`select data from crm_docs where coll = ${coll} and doc_id = ${clientDoc} and deleted_at is null`
  if (!r) return
  const log = Array.isArray(r.data.log) ? r.data.log : []
  await writeDoc(coll + '/' + clientDoc, 'update', { ...patch, log: [{ at: now.toISOString(), text, auto: true, by: 'sign' }, ...log].slice(0, 300), updatedAt: now.toISOString() })
}

async function notifyOwner(env: EnvelopeRow, what: string, dedup: string, payload: Record<string, unknown> | null, driveUrl: string | null = null): Promise<void> {
  const [owner] = await sql<{ value: string | null }[]>`select data->>'ownerEmail' as value from crm_docs where coll = 'settings' and doc_id = 'main' and deleted_at is null`.catch(() => [])
  const to = cleanEmail(owner?.value) || cleanEmail(process.env.OWNER_EMAIL)
  if (!to) return
  await sql`insert into outbox (channel, target, subject, body, payload, dedup_key)
    values ('email', ${to}, ${'חתימה: ' + env.title + ' — ' + env.client_name},
      ${'<div dir="rtl" style="font-family:Arial,sans-serif">' + escHtml(env.client_name) + ' · ' + escHtml(env.title) + ': ' + escHtml(what) + '.' + (driveUrl ? ' <a href="' + escHtml(driveUrl) + '">בדרייב</a>' : '') + '</div>'},
      ${payload ? sql.json(payload as never) : null}, ${dedup})
    on conflict (dedup_key) where dedup_key is not null and deleted_at is null do nothing`
}

export { groupByDocument }
