'use server'

import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { ACTOR_ID } from '@/lib/db'
import { ignoreCandidate, processIntakeFile, verifyCandidate, type VerifiedFields } from '@/lib/intake/pipeline'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** העלאה ידנית (צילום חשבונית מהנייד, UIUX §6) — אותו צינור של Gmail/Drive. */
export async function uploadIntake(fd: FormData): Promise<Result<{ candidateId: string | null; status: string; kind: string }>> {
  const file = fd.get('file')
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'לא נבחר קובץ' }
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: 'הקובץ גדול מ-15MB' }
  const buf = Buffer.from(await file.arrayBuffer())
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 24)
  try {
    const r = await processIntakeFile({ source: 'manual_upload', sourceRef: hash, fileName: file.name, buf, subject: String(fd.get('note') ?? '') || undefined })
    revalidatePath('/import/inbox'); revalidatePath('/import')
    if (r.status === 'failed') return { ok: false, error: r.error ?? 'הקליטה נכשלה' }
    return { ok: true, candidateId: r.candidateId, status: r.status, kind: r.kind }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

function num(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const n = Number(v.replace(/[,\s₪]/g, '')); return Number.isFinite(n) ? n : null
}

/** "נכון ✓" — האישור האנושי (הנחיה 17). */
export async function verifyIntake(candidateId: string, fd: FormData): Promise<Result<{ invoiceId: string; matchedTxId: string | null; forwarded: boolean }>> {
  const gross = num(fd.get('gross')), vat = num(fd.get('vat')), net = num(fd.get('net'))
  const date = String(fd.get('date') ?? '')
  if (gross === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'תאריך וסכום כולל הם חובה' }
  const vatV = vat ?? Math.round((gross - (net ?? gross / 1.18)) * 100) / 100
  const netV = net ?? Math.round((gross - vatV) * 100) / 100
  const fields: VerifiedFields = {
    supplierId: String(fd.get('supplier_id') ?? '') || null, supplierName: String(fd.get('supplier_name') ?? '').trim() || undefined,
    docNumber: String(fd.get('doc_number') ?? '').trim() || null, date, gross, vat: vatV, net: netV,
    dueDate: String(fd.get('due_date') ?? '') || null, txId: String(fd.get('tx_id') ?? '') || null, learnTemplate: fd.get('learn') !== 'off',
  }
  try {
    const r = await verifyCandidate(candidateId, fields, ACTOR_ID)
    revalidatePath('/import/inbox'); revalidatePath('/transactions'); revalidatePath('/')
    return { ok: true, ...r }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

export async function ignoreIntake(candidateId: string, reason?: string): Promise<Result> {
  try { await ignoreCandidate(candidateId, reason); revalidatePath('/import/inbox'); return { ok: true } } catch (e) { return { ok: false, error: (e as Error).message } }
}
