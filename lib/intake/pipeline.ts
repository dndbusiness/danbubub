/**
 * צינור הקליטה — ADDENDUM ב.3. אותו צינור לשלושת המקורות: Gmail, תיקיית Drive "להזנה", העלאה ידנית.
 *   שמירת הקובץ → סינון (חשבונית / דף פירוט / לא ידוע) → חילוץ (תבנית → כללים → LLM כהצעה)
 *   → inbox_candidates (pending, verified=false) → משימה "חשבונית במייל לאישור" (rule_key) → דרייב.
 * verified רק ב-verifyCandidate, ע"י אדם (הנחיה 17 — נאכף גם ב-DB).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { sql, withActor } from '@/lib/db'
import { classifyIntake, extractByRules, extractByTemplate, findSupplier, intakeFileName, learnTemplate, type Extracted, type KnownSupplier } from './extract'
import { pdfToText } from './pdf'
import { llmAvailable, proposeWithClaude } from './llm'
import { INVOICE_MATCH, matchTarget } from '@/lib/match/invoices'
import { ensureFolderPath, reportFolder, uploadFile } from '@/lib/google/drive'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { enqueueOutbox } from '@/lib/jobs/outbox'

export const INTAKE_DIR = process.env.HAREL_INTAKE_DIR ?? path.join(process.cwd(), 'storage', 'intake')

export interface IntakeInput {
  source: 'gmail' | 'drive' | 'manual_upload'
  sourceRef: string
  fileName: string
  buf: Buffer
  sender?: string
  subject?: string
  receivedAt?: string
}

export interface IntakeOutcome { candidateId: string | null; status: 'created' | 'duplicate' | 'failed'; kind: 'invoice' | 'statement' | 'unknown'; extracted?: Extracted; error?: string }

export async function knownSuppliers(): Promise<KnownSupplier[]> {
  const rows = await sql<{ id: string; name: string; aliases: string[]; emails: string[]; extraction_template: KnownSupplier['extractionTemplate'] }[]>`
    select id, name, aliases, emails, extraction_template from suppliers where deleted_at is null`
  return rows.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, emails: r.emails, extractionTemplate: r.extraction_template }))
}

export async function processIntakeFile(input: IntakeInput, opts: { useLlm?: boolean } = {}): Promise<IntakeOutcome> {
  const [dup] = await sql<{ id: string }[]>`select id from inbox_candidates where source = ${input.source} and source_ref = ${input.sourceRef} and deleted_at is null`
  if (dup) return { candidateId: dup.id, status: 'duplicate', kind: 'unknown' }

  mkdirSync(INTAKE_DIR, { recursive: true })
  const ext = path.extname(input.fileName).toLowerCase() || '.bin'
  const localPath = path.join(INTAKE_DIR, `${input.source}-${input.sourceRef.replace(/[^\w.-]+/g, '_')}${ext}`)
  writeFileSync(localPath, input.buf)

  const suppliers = await knownSuppliers()
  let text = ''
  let needsOcr = false
  const pdfWarnings: string[] = []
  if (ext === '.pdf') {
    try { const r = await pdfToText(input.buf); text = r.text; needsOcr = r.needsOcr } catch (e) { needsOcr = true; text = ''; pdfWarnings.push(`קריאת PDF נכשלה: ${(e as Error).message.slice(0, 120)}`) }
  } else if (ext === '.csv' || ext === '.txt') text = input.buf.toString('utf8').slice(0, 20_000)

  const kind = classifyIntake({ sender: input.sender, subject: input.subject, fileName: input.fileName, text }, suppliers)
  let extracted: Extracted | null = null
  if (kind !== 'statement') {
    const supplier = findSupplier({ sender: input.sender, text }, suppliers)
    extracted = supplier?.extractionTemplate ? extractByTemplate(text, supplier) : extractByRules(text, supplier)
    if (needsOcr) extracted.warnings.push('PDF סרוק — אין טקסט; נדרש OCR או הזנה ידנית', ...pdfWarnings)
    // ב.3: LLM רק למסמך לא מוכר / ביטחון נמוך, ותמיד כהצעה (הנחיה 17).
    if ((opts.useLlm ?? true) && llmAvailable() && (!supplier || extracted.confidence < 0.6)) {
      try {
        const llm = await proposeWithClaude(needsOcr ? { pdf: input.buf, fileName: input.fileName } : { text, fileName: input.fileName })
        extracted = { ...llm, supplierId: supplier?.id ?? llm.supplierId, supplierName: supplier?.name ?? llm.supplierName, warnings: [...extracted.warnings, ...llm.warnings] }
      } catch (e) { extracted.warnings.push(`LLM: ${(e as Error).message}`) }
    }
  }

  const candidateId = await withActor(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into inbox_candidates (source, source_ref, received_at, sender, subject, file_name, extracted, extraction_method, kind, doc_text, local_path, status)
      values (${input.source}, ${input.sourceRef}, ${input.receivedAt ?? new Date().toISOString()}, ${input.sender ?? null}, ${input.subject ?? null}, ${input.fileName},
              ${extracted ? tx.json(extracted as never) : null}, ${extracted?.method === 'llm' ? 'llm' : extracted ? 'template' : null}, ${kind}, ${text.slice(0, 50_000) || null}, ${localPath}, 'pending')
      on conflict (source, source_ref) do update
        -- מועמד שנמחק (soft delete) ונשלח שוב — קם לתחייה במקום להיחסם; פעיל → לא נוגעים.
        set deleted_at = null, status = 'pending', verified = false, verified_by = null, verified_at = null, invoice_id = null, matched_tx_id = null,
            extracted = excluded.extracted, extraction_method = excluded.extraction_method, kind = excluded.kind, doc_text = excluded.doc_text, local_path = excluded.local_path, received_at = excluded.received_at
        where inbox_candidates.deleted_at is not null
      returning id`
    if (!row) return null
    // ב.10 — "חשבונית במייל לאישור" עם rule_key; נסגרת לבד באישור/התעלמות.
    await tx`
      insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
      values (${kind === 'statement' ? `דף פירוט לייבוא: ${input.fileName}` : `חשבונית לאישור: ${extracted?.supplierName ?? input.sender ?? input.fileName}${extracted?.gross !== undefined ? ` · ${extracted.gross} ₪` : ''}`},
              current_date + 2, 'normal', true, ${`inbox:${row.id}`}, ${`מקור: ${input.source} · ${input.subject ?? ''}`})
      on conflict do nothing`
    return row.id
  })
  if (!candidateId) return { candidateId: null, status: 'duplicate', kind }

  // ב.3 שלב 8 — דרייב חשבוניות/received/YYYY/MM/{תאריך}_{ספק}_{סכום}.pdf (אם מחובר)
  if (kind === 'invoice' && ext === '.pdf') {
    const google = await googleIntegration()
    if (hasScope(google, 'https://www.googleapis.com/auth/drive.file')) {
      try {
        const token = await googleAccessToken()
        const month = (extracted?.date ?? input.receivedAt ?? new Date().toISOString()).slice(0, 7)
        const folder = await ensureFolderPath(token, reportFolder('invoices_received', month))
        const up = await uploadFile(token, folder, intakeFileName(extracted!, input.fileName), 'application/pdf', input.buf)
        await sql`update inbox_candidates set file_url = ${up.webViewLink} where id = ${candidateId}`
      } catch (e) { console.error('Drive intake upload failed:', (e as Error).message) }
    }
  }
  return { candidateId, status: 'created', kind, extracted: extracted ?? undefined }
}

export interface VerifiedFields { supplierId?: string | null; supplierName?: string; docNumber?: string | null; date: string; gross: number; vat: number; net: number; dueDate?: string | null; txId?: string | null; learnTemplate?: boolean }

/**
 * אישור אנושי (הנחיה 17): יוצר invoices(received), משדך לתנועה (ב.3 שלב 5), לומד תבנית לספק,
 * מעביר לחשבונית ירוקה דרך outbox (שלב 6), סוגר את המשימה.
 */
export async function verifyCandidate(candidateId: string, f: VerifiedFields, actorId: string): Promise<{ invoiceId: string; matchedTxId: string | null; forwarded: boolean }> {
  const [c] = await sql<{ id: string; file_name: string; doc_text: string | null; local_path: string | null; source_ref: string; source: string; status: string }[]>`
    select id, file_name, doc_text, local_path, source_ref, source, status from inbox_candidates where id = ${candidateId} and deleted_at is null`
  if (!c) throw new Error('מועמד לא נמצא')
  if (c.status !== 'pending') throw new Error('המועמד כבר טופל')
  if (Math.abs(f.net + f.vat - f.gross) > 1) throw new Error('נטו + מע"מ חייבים להסתכם לברוטו (±1 ₪)')

  // ספק: קיים / חדש לפי שם
  let supplierId = f.supplierId ?? null
  if (!supplierId && f.supplierName?.trim()) {
    const [existing] = await sql<{ id: string }[]>`select id from suppliers where deleted_at is null and (lower(name) = lower(${f.supplierName.trim()}) or ${f.supplierName.trim()} = any(aliases)) limit 1`
    supplierId = existing?.id ?? null
  }

  // שידוך — ב.3 שלב 5 (אם המשתמש לא בחר תנועה ידנית)
  let matchedTxId = f.txId ?? null
  if (!matchedTxId) {
    const txs = await sql<{ id: string; date_cash: string; amount_gross: number; counterparty: string | null; description: string | null; invoice_id: string | null }[]>`
      select id, to_char(date_cash, 'YYYY-MM-DD') as date_cash, amount_gross, counterparty, description, invoice_id from transactions
      where nature = 'expense' and deleted_at is null and certainty = 'actual' and date_cash between ${f.date}::date - 30 and ${f.date}::date + 30`
    const sup = supplierId ? (await sql<{ name: string; aliases: string[] }[]>`select name, aliases from suppliers where id = ${supplierId}`)[0] : null
    const r = matchTarget({ amountGross: f.gross, date: f.date, supplierName: sup?.name ?? f.supplierName, supplierAliases: sup?.aliases }, txs.map((t) => ({ id: t.id, dateCash: t.date_cash, amountGross: t.amount_gross, counterparty: t.counterparty, description: t.description, invoiceId: t.invoice_id })), INVOICE_MATCH)
    if (r.status === 'matched') matchedTxId = r.best!.tx.id
  }

  const out = await withActor(async (tx) => {
    if (!supplierId && f.supplierName?.trim()) {
      const [s] = await tx<{ id: string }[]>`insert into suppliers (name) values (${f.supplierName.trim()}) returning id`
      supplierId = s!.id
    }
    const [inv] = await tx<{ id: string }[]>`
      insert into invoices (direction, doc_type, doc_number, date, counterparty, supplier_id, amount_net, vat_amount, amount_gross, matched_tx_id, vat_period, source, source_ref, file_url, due_date, inbox_candidate_id)
      values ('received', 'invoice', ${f.docNumber ?? null}, ${f.date}, ${f.supplierName ?? null}, ${supplierId}, ${-Math.abs(f.net)}, ${-Math.abs(f.vat)}, ${-Math.abs(f.gross)},
              ${matchedTxId}, ${f.date.slice(0, 7)}, ${c.source === 'gmail' ? 'manual' : 'manual'}, ${`${c.source}:${c.source_ref}`}, ${c.local_path}, ${f.dueDate ?? null}, ${candidateId})
      returning id`
    if (matchedTxId) await tx`update transactions set invoice_status = 'has_invoice', invoice_id = ${inv!.id} where id = ${matchedTxId} and deleted_at is null`
    await tx`
      update inbox_candidates set verified = true, verified_by = ${actorId}, verified_at = now(), invoice_id = ${inv!.id}, matched_tx_id = ${matchedTxId},
        status = 'matched', extracted = coalesce(extracted, '{}'::jsonb) || ${tx.json({ verified: { ...f, supplierId } } as never)}
      where id = ${candidateId}`
    // תבנית לספק — נלמדת מהמסמך הראשון שאושר (ב.3 שלב 3)
    if (supplierId && c.doc_text && f.learnTemplate !== false) {
      const [s] = await tx<{ extraction_template: unknown }[]>`select extraction_template from suppliers where id = ${supplierId}`
      if (!s?.extraction_template) {
        const tpl = learnTemplate(c.doc_text, { docNumber: f.docNumber ?? undefined, date: f.date, gross: f.gross, vat: f.vat, net: f.net })
        if (Object.values(tpl).some(Boolean)) await tx`update suppliers set extraction_template = ${tx.json(tpl as never)} where id = ${supplierId}`
      }
    }
    await tx`update tasks set status = 'done', notes = coalesce(notes, '') || ' · אושר' where auto_key = ${`inbox:${candidateId}`} and status <> 'done'`
    return { invoiceId: inv!.id }
  })

  // ב.3 שלב 6 — העברה לחשבונית ירוקה (דרך outbox), אלא אם המסמך כבר קיים בייצוא שלה.
  let forwarded = false
  const [gi] = await sql<{ value: string }[]>`select value #>> '{}' as value from settings where key = 'greeninvoice_intake_email'`
  if (gi?.value && c.local_path) {
    const [exists] = f.docNumber ? await sql<{ id: string }[]>`
      select id from invoices where source = 'greeninvoice_import' and doc_number = ${f.docNumber} and deleted_at is null and id <> ${out.invoiceId} limit 1` : []
    if (!exists) {
      const n = await enqueueOutbox([{ channel: 'email', target: gi.value, subject: `חשבונית ${f.docNumber ?? ''} — ${f.supplierName ?? ''}`, body: `<p>חשבונית שהתקבלה ב-${c.source}. סכום ${f.gross} ₪, תאריך ${f.date}.</p>`, dedupKey: `gi_forward:${out.invoiceId}` }])
      if (n) {
        const [ob] = await sql<{ id: string }[]>`select id from outbox where dedup_key = ${`gi_forward:${out.invoiceId}`}`
        await sql`update outbox set payload = ${sql.json({ pdfPath: c.local_path, fileName: c.file_name })} where id = ${ob!.id}`
        await sql`update inbox_candidates set forwarded_outbox_id = ${ob!.id} where id = ${candidateId}`
        forwarded = true
      }
    }
  }
  return { invoiceId: out.invoiceId, matchedTxId, forwarded }
}

export async function ignoreCandidate(candidateId: string, reason?: string): Promise<void> {
  await withActor(async (tx) => {
    await tx`update inbox_candidates set status = 'ignored', failure_reason = ${reason ?? null} where id = ${candidateId} and status = 'pending'`
    await tx`update tasks set status = 'cancelled' where auto_key = ${`inbox:${candidateId}`} and status <> 'done'`
  })
}
