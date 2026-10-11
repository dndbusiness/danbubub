/**
 * חתימה דיגיטלית — הצד שמדבר עם ה-DB, ה-PDF, הדרייב וה-CRM. הכללים עצמם ב-lib/rules/sign.ts.
 *
 * זרימה:
 *   createRequest  — דן שולח מהכרטיס: צילום נוסח + SHA-256, טוקן אקראי (נשמר רק ה-hash), קישור /s/<token>,
 *                    מייל ללקוח דרך outbox (הנחיה 16). וואטסאפ — הקישור חוזר לדף ונשלח מהטלפון של דן.
 *   openRequest    — הלקוח פתח: opened_at (פעם אחת).
 *   submitRequest  — הלקוח חתם: בדיקה, עדכון מותנה (רק אם עוד פתוח ובתוקף) → נעול ב-DB.
 *   finalize       — PDF (Playwright, אותו עמוד /s/print/<id>) → דרייב "הסכמי התקשרות" → כרטיס הלקוח
 *                    → מייל לדן ועותק ללקוח דרך outbox. נכשל? הכרטיס מציג "צור PDF שוב".
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { sql } from '@/lib/db'
import { expiryFrom, renderAgreement, signState, validateSubmission, type FieldValue, type SignState, type Submission } from '@/lib/rules/sign'
import { writeDoc } from '@/lib/crm/store'
import { googleAccessToken } from '@/lib/google/store'
import { ensureChildFolder, uploadFile } from '@/lib/google/drive'
import { internalBaseUrl, renderPdf } from '@/lib/pdf'

export const AGREEMENTS_FOLDER = 'הסכמי התקשרות'

export interface SignRow {
  id: string; client_doc: string; client_name: string; division: 'finance' | 'realestate'; title: string; body_html: string; doc_hash: string
  fields: Record<string, FieldValue>; send_email: string | null; send_phone: string | null; status: 'sent' | 'opened' | 'signed' | 'cancelled'
  expires_at: string; opened_at: string | null; signed_at: string | null; signer_name: string | null; signer_id_number: string | null
  signature_png: string | null; signer_ip: string | null; signer_ua: string | null; pdf_path: string | null; drive_file_id: string | null; drive_url: string | null
  finalize_error: string | null; created_at: string; deleted_at: string | null
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const newToken = () => randomBytes(24).toString('base64url')

/** כתובת ציבורית לקישורים שיוצאים ללקוח. */
export function publicBaseUrl(fallback?: string): string {
  return (process.env.APP_BASE_URL || fallback || internalBaseUrl()).replace(/\/+$/, '')
}

/** חתימה על מזהה — לעמוד ההדפסה הפנימי (ממנו נוצר ה-PDF), בלי לחשוף את הטוקן של הלקוח. */
export function printKey(id: string): string {
  const secret = process.env.SIGN_SECRET ?? process.env.APP_PASSWORD ?? process.env.DATABASE_URL ?? 'harel-dev'
  return createHmac('sha256', secret).update('sign-print:' + id).digest('hex').slice(0, 32)
}
export function checkPrintKey(id: string, key: string | null | undefined): boolean {
  const a = Buffer.from(printKey(id)), b = Buffer.from(String(key ?? ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface CreateInput {
  clientDoc: string; clientName: string; division: 'finance' | 'realestate'; title: string; template: string
  fields: Record<string, FieldValue>; email?: string | null; phone?: string | null; expiresDays?: number | null; allowMissing?: boolean
}

export async function createRequest(input: CreateInput, now: Date, baseUrl?: string): Promise<{ id: string; url: string; missing: string[]; emailQueued: boolean } | { missing: string[]; error: string }> {
  const { html, missing } = renderAgreement(input.template, input.fields)
  if (!html.trim()) return { missing, error: 'הנוסח ריק' }
  if (missing.length && !input.allowMissing) return { missing, error: 'חסרים שדות בנוסח: ' + missing.join(', ') }
  const token = newToken(), email = cleanEmail(input.email), phone = String(input.phone ?? '').replace(/[^\d+]/g, '') || null
  const [row] = await sql<{ id: string }[]>`
    insert into sign_requests (token_hash, client_doc, client_name, division, title, body_html, doc_hash, fields, send_email, send_phone, expires_at)
    values (${sha256(token)}, ${input.clientDoc}, ${input.clientName}, ${input.division}, ${input.title}, ${html}, ${sha256(html)},
            ${sql.json(input.fields as never)}, ${email}, ${phone}, ${expiryFrom(now, input.expiresDays)})
    returning id`
  if (!row) throw new Error('יצירת הבקשה נכשלה')
  const url = `${publicBaseUrl(baseUrl)}/s/${token}`
  let emailQueued = false
  if (email) {
    await sql`insert into outbox (channel, target, subject, body, dedup_key)
      values ('email', ${email}, ${input.title + ' — לחתימה'}, ${inviteHtml(input.clientName, input.title, url)}, ${'sign-invite:' + row.id})
      on conflict (dedup_key) where dedup_key is not null and deleted_at is null do nothing`
    emailQueued = true
  }
  await crmLog(input.clientDoc, 'נשלח הסכם לחתימה: ' + input.title + (email ? ' · במייל ל-' + email : '') + (phone ? ' · וואטסאפ ' + phone : ''), now, { agreementSignId: row.id, agreementStatus: 'sent' })
  return { id: row.id, url, missing, emailQueued }
}

export async function listForClient(clientDoc: string): Promise<Omit<SignRow, 'body_html' | 'signature_png'>[]> {
  return sql`
    select id, client_doc, client_name, division, title, doc_hash, fields, send_email, send_phone, status, expires_at, opened_at, signed_at,
           signer_name, signer_id_number, signer_ip, signer_ua, pdf_path, drive_file_id, drive_url, finalize_error, created_at, deleted_at
    from sign_requests where client_doc = ${clientDoc} and deleted_at is null order by created_at desc limit 20`
}

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

/** הלקוח פתח את הקישור. */
export async function openRequest(token: string, now: Date): Promise<{ row: SignRow; state: SignState } | null> {
  const row = await byToken(token)
  if (!row) return null
  const state = signState(row, now)
  if (state === 'open' && row.status === 'sent') {
    await sql`update sign_requests set status = 'opened', opened_at = now() where id = ${row.id} and status = 'sent'`
    await crmLog(row.client_doc, 'הלקוח פתח את ההסכם לחתימה', now, { agreementStatus: 'opened' }).catch(() => {})
  }
  return { row, state }
}

export async function submitRequest(token: string, s: Partial<Submission>, meta: { ip: string | null; ua: string | null }, now: Date):
  Promise<{ ok: true; id: string } | { ok: false; errors: string[]; state?: SignState }> {
  const row = await byToken(token)
  if (!row) return { ok: false, errors: ['הקישור לא נמצא'] }
  const state = signState(row, now)
  if (state !== 'open') return { ok: false, errors: [state === 'signed' ? 'ההסכם כבר נחתם' : state === 'expired' ? 'תוקף הקישור פג — בקשו קישור חדש' : 'הקישור בוטל'], state }
  const errors = validateSubmission(s)
  if (errors.length) return { ok: false, errors }
  const id = String(s.idNumber).replace(/\D/g, '').padStart(9, '0')
  const res = await sql`
    update sign_requests set status = 'signed', signed_at = ${now}, signer_name = ${String(s.name).trim()}, signer_id_number = ${id},
      signature_png = ${String(s.signature)}, signer_ip = ${meta.ip}, signer_ua = ${(meta.ua ?? '').slice(0, 400)}
    where id = ${row.id} and status in ('sent', 'opened') and deleted_at is null and expires_at > ${now}`
  if (!res.count) return { ok: false, errors: ['ההסכם כבר נחתם או שהקישור לא בתוקף'] }
  return { ok: true, id: row.id }
}

/** PDF → דרייב → כרטיס הלקוח → התראות. אפשר להריץ שוב (מהכרטיס) אם נכשל. */
export async function finalize(id: string, now: Date): Promise<{ ok: boolean; driveUrl?: string; error?: string }> {
  const row = await byId(id)
  if (!row || row.status !== 'signed') return { ok: false, error: 'לא נחתם' }
  const file = `הסכם התקשרות — ${safeName(row.client_name)} — ${new Date(row.signed_at!).toISOString().slice(0, 10)} — ${row.id.slice(0, 8)}.pdf`
  // 1. PDF — בלעדיו אין מה לשמור או לשלוח
  let pdfPath: string
  try {
    pdfPath = row.pdf_path && (await readFile(row.pdf_path).then(() => true).catch(() => false))
      ? row.pdf_path : await renderPdf(`${internalBaseUrl()}/s/print/${row.id}?k=${printKey(row.id)}`, `sign-${row.id}.pdf`)
    await sql`update sign_requests set pdf_path = ${pdfPath} where id = ${row.id}`
  } catch (e) {
    const msg = 'יצירת ה-PDF נכשלה: ' + (e as Error).message
    await sql`update sign_requests set finalize_error = ${msg.slice(0, 500)} where id = ${row.id}`
    await crmLog(row.client_doc, `ההסכם נחתם ע"י ${row.signer_name} — ${msg.slice(0, 160)}`, now, { agreementStatus: 'signed', agreementSignedAt: row.signed_at, agreementSignId: row.id }).catch(() => {})
    return { ok: false, error: msg }
  }
  // 2. דרייב — כישלון כאן לא עוצר את ההודעות (ה-PDF מצורף למייל); הכרטיס מציג "צור PDF שוב"
  let driveUrl = row.drive_url, driveErr: string | null = null
  if (!row.drive_file_id) {
    try {
      const folder = await clientDriveFolder(row.client_doc)
      if (!folder) throw new Error('ללקוח אין תיקייה בדרייב — פתח תיקייה בכרטיס ולחץ "צור PDF שוב"')
      const token = await googleAccessToken()
      const sub = await ensureChildFolder(token, folder, AGREEMENTS_FOLDER)
      const up = await uploadFile(token, sub, file, 'application/pdf', await readFile(pdfPath))
      await sql`update sign_requests set drive_file_id = ${up.id}, drive_url = ${up.webViewLink} where id = ${row.id}`
      driveUrl = up.webViewLink
    } catch (e) { driveErr = 'לא נשמר בדרייב: ' + (e as Error).message }
  }
  await sql`update sign_requests set finalize_error = ${driveErr ? driveErr.slice(0, 500) : null} where id = ${row.id}`
  // 3. כרטיס הלקוח + מייל לדן ועותק ללקוח (dedup — הרצה חוזרת לא שולחת שוב)
  await crmLog(row.client_doc, `ההסכם נחתם ע"י ${row.signer_name}` + (driveUrl ? ` · נשמר בדרייב (${AGREEMENTS_FOLDER})` : driveErr ? ' — ' + driveErr.slice(0, 140) : ''), now,
    { agreementStatus: 'signed', agreementSignedAt: row.signed_at, agreementSignId: row.id, ...(driveUrl ? { agreementPdfUrl: driveUrl } : {}) }).catch(() => {})
  await notifySigned(row, pdfPath, file, driveUrl ?? null)
  return driveErr ? { ok: false, error: driveErr } : { ok: true, driveUrl: driveUrl ?? undefined }
}

export async function cancelRequest(id: string, now: Date): Promise<boolean> {
  const row = await byId(id)
  if (!row || row.status === 'signed') return false
  const res = await sql`update sign_requests set status = 'cancelled' where id = ${id} and status in ('sent', 'opened')`
  if (res.count) await crmLog(row.client_doc, 'בקשת החתימה בוטלה: ' + row.title, now, { agreementStatus: 'cancelled' }).catch(() => {})
  return res.count > 0
}

/* ── עזר ────────────────────────────────────────────────────────────────── */

function cleanEmail(e: string | null | undefined): string | null {
  const v = String(e ?? '').trim().toLowerCase()
  return /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(v) ? v : null
}
const safeName = (s: string) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)
const escHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function inviteHtml(name: string, title: string, url: string): string {
  return '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">' +
    `<p>שלום ${escHtml(String(name).split(/\s+/)[0] ?? '')},</p><p>מצורף קישור לקריאה וחתימה על <b>${escHtml(title)}</b>.</p>` +
    `<p><a href="${escHtml(url)}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">לקריאה וחתימה</a></p>` +
    '<p style="color:#6B7280;font-size:13px">החתימה נעשית בטלפון או במחשב, בלי הרשמה. אחרי החתימה יישלח אליך עותק חתום.</p><p>הר-אל</p></div>'
}

async function clientDriveFolder(clientDoc: string): Promise<string | null> {
  const [r] = await sql<{ folder: string | null }[]>`select data->>'driveFolder' as folder from crm_docs where coll = 'clients' and doc_id = ${clientDoc} and deleted_at is null`
  return r?.folder && /^[A-Za-z0-9_-]{10,}$/.test(r.folder) ? r.folder : null
}

/** רישום ביומן הלקוח ב-CRM (המסמך clients/<id>), ועדכון שדות הסטטוס בכרטיס. */
export async function crmLog(clientDoc: string, text: string, now: Date, patch: Record<string, unknown> = {}): Promise<void> {
  const [r] = await sql<{ data: { log?: unknown[] } }[]>`select data from crm_docs where coll = 'clients' and doc_id = ${clientDoc} and deleted_at is null`
  if (!r) return
  const log = Array.isArray(r.data.log) ? r.data.log : []
  await writeDoc('clients/' + clientDoc, 'update', { ...patch, log: [{ at: now.toISOString(), text, auto: true, by: 'sign' }, ...log].slice(0, 300), updatedAt: now.toISOString() })
}

async function notifySigned(row: SignRow, pdfPath: string, fileName: string, driveUrl: string | null): Promise<void> {
  const [owner] = await sql<{ value: string | null }[]>`select data->>'ownerEmail' as value from crm_docs where coll = 'settings' and doc_id = 'main' and deleted_at is null`.catch(() => [])
  const ownerEmail = cleanEmail(owner?.value) || cleanEmail(process.env.OWNER_EMAIL) || null
  const payload = { pdfPath, fileName }
  const when = new Date(row.signed_at!).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })
  if (ownerEmail) await sql`insert into outbox (channel, target, subject, body, payload, dedup_key)
    values ('email', ${ownerEmail}, ${'נחתם: ' + row.title + ' — ' + row.client_name},
      ${'<div dir="rtl" style="font-family:Arial,sans-serif">' + escHtml(row.signer_name ?? '') + ' חתם/ה על ' + escHtml(row.title) + ' ב-' + escHtml(when) + '.' + (driveUrl ? ' <a href="' + escHtml(driveUrl) + '">בדרייב</a>' : '') + '</div>'},
      ${sql.json(payload as never)}, ${'sign-done-owner:' + row.id})
    on conflict (dedup_key) where dedup_key is not null and deleted_at is null do nothing`
  if (row.send_email) await sql`insert into outbox (channel, target, subject, body, payload, dedup_key)
    values ('email', ${row.send_email}, ${'עותק חתום — ' + row.title},
      ${'<div dir="rtl" style="font-family:Arial,sans-serif">שלום ' + escHtml(String(row.signer_name ?? '').split(/\s+/)[0] ?? '') + ', מצורף העותק החתום של ' + escHtml(row.title) + '. תודה, הר-אל</div>'},
      ${sql.json(payload as never)}, ${'sign-done-client:' + row.id})
    on conflict (dedup_key) where dedup_key is not null and deleted_at is null do nothing`
  void fileName
}
