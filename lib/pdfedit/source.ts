/**
 * עורך ה-PDF — מאיפה הקובץ בא ולאן הוא נשמר.
 *   { drive: id } — קובץ בתיק הלקוח בדרייב. השמירה: קובץ חדש "(ערוך)" באותה תיקייה — המקור לא נדרס.
 *   { file: id }  — קובץ במערכת (stored_files: טפסים שהועלו, PDF חתום). השמירה: קובץ חדש במערכת.
 * הקובץ עובר בין השרת לגוגל ישירות — בלי מגבלת 4.5MB של גוף הבקשה בדפדפן (lib/crm/drive-direct.ts).
 */
import { googleAccessToken } from '@/lib/google/store'
import { DriveDirectError, fileStream, uploadSession } from '@/lib/crm/drive-direct'
import { readStoredFile, storeFile, storedFileUrl } from '@/lib/files'
import { PdfEditError } from './engine'

export type PdfSrc = { drive: string } | { file: string }
export const MAX_SOURCE_BYTES = 80_000_000

export function parseSrc(v: unknown): PdfSrc | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  if (typeof o.drive === 'string' && /^[\w-]{10,200}$/.test(o.drive)) return { drive: o.drive }
  if (typeof o.file === 'string' && /^[0-9a-f-]{36}$/i.test(o.file)) return { file: o.file }
  return null
}

async function collect(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) throw new PdfEditError('not_found', 'הקובץ ריק')
  const parts: Uint8Array[] = []; let n = 0
  const r = body.getReader()
  for (;;) {
    const { done, value } = await r.read(); if (done) break
    n += value.byteLength; if (n > MAX_SOURCE_BYTES) { await r.cancel(); throw new PdfEditError('invalid_argument', 'הקובץ גדול מדי לעריכה (עד 80MB)') }
    parts.push(value)
  }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength }
  return out
}

export interface Loaded { bytes: Uint8Array; name: string; parentId: string | null }

export async function loadSource(src: PdfSrc, fetchImpl: typeof fetch = fetch): Promise<Loaded> {
  if ('file' in src) {
    const f = await readStoredFile(src.file)
    if (!f) throw new PdfEditError('not_found', 'הקובץ לא נמצא במערכת')
    return { bytes: new Uint8Array(f.bytes), name: f.name, parentId: null }
  }
  const token = await googleAccessToken().catch((e: Error) => { throw new PdfEditError('server_not_connected', e.message) })
  const meta = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${src.drive}?fields=name,parents&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } })
  const parentId = meta.ok ? ((await meta.json()) as { parents?: string[] }).parents?.[0] ?? null : null
  const f = await fileStream(token, src.drive, 'application/pdf', fetchImpl)
  if (f.mimeType !== 'application/pdf') throw new PdfEditError('invalid_argument', 'זה לא קובץ PDF')
  return { bytes: await collect(f.body), name: f.name, parentId }
}

export interface Saved { where: 'drive' | 'file'; id: string; name: string; url: string }

/** קובץ חדש ליד המקור. בדרייב: העלאה נמשכת (גם קבצים גדולים) לאותה תיקייה. */
export async function saveResult(src: PdfSrc | null, loaded: Loaded | null, bytes: Uint8Array, name: string, fetchImpl: typeof fetch = fetch): Promise<Saved> {
  if (src && 'drive' in src) {
    const token = await googleAccessToken().catch((e: Error) => { throw new PdfEditError('server_not_connected', e.message) })
    const url = await uploadSession(token, { title: name, mimeType: 'application/pdf', parentId: loaded?.parentId ?? null, size: bytes.byteLength }, null, fetchImpl)
    const res = await fetchImpl(url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: bytes as unknown as BodyInit })
    if (!res.ok) throw new DriveDirectError(res.status === 403 ? 'not_granted' : 'tool_error', `Drive ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    const j = await res.json() as { id: string; name: string; webViewLink?: string }
    return { where: 'drive', id: j.id, name: j.name, url: j.webViewLink || `https://drive.google.com/file/d/${j.id}/view` }
  }
  const id = await storeFile(bytes, name, 'application/pdf', 'pdfedit')
  return { where: 'file', id, name, url: storedFileUrl(id) }
}
