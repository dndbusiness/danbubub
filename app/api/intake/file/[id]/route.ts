import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from '@/lib/db'
import { readStoredFile } from '@/lib/files'
import { INTAKE_DIR } from '@/lib/intake/pipeline'

export const dynamic = 'force-dynamic'

/** הקובץ המקורי של מועמד קליטה: מהמסד (file_id), ובגיבוי מהדיסק המקומי (התקנה על שרת אחד). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('לא נמצא', { status: 404 })
  const [c] = await sql<{ local_path: string | null; file_id: string | null; file_name: string | null }[]>`select local_path, file_id, file_name from inbox_candidates where id = ${id} and deleted_at is null`
  if (!c) return new Response('לא נמצא', { status: 404 })
  const disposition = `inline; filename*=UTF-8''${encodeURIComponent(c.file_name ?? 'file')}`
  const stored = c.file_id ? await readStoredFile(c.file_id) : null
  if (stored) return new Response(new Uint8Array(stored.bytes), { headers: { 'content-type': stored.mime, 'content-disposition': disposition } })
  if (!c.local_path || !path.resolve(c.local_path).startsWith(path.resolve(INTAKE_DIR))) return new Response('לא נמצא', { status: 404 })
  const ext = path.extname(c.local_path).toLowerCase()
  const type = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : /\.jpe?g$/.test(ext) ? 'image/jpeg' : 'application/octet-stream'
  const buf = await readFile(c.local_path).catch(() => null)
  if (!buf) return new Response('הקובץ לא נמצא בשרת', { status: 404 })
  return new Response(new Uint8Array(buf), { headers: { 'content-type': type, 'content-disposition': disposition } })
}
