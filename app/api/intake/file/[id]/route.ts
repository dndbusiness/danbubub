import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from '@/lib/db'
import { INTAKE_DIR } from '@/lib/intake/pipeline'

export const dynamic = 'force-dynamic'

/** הקובץ המקורי של מועמד קליטה (מקומי; בדרייב — file_url). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [c] = await sql<{ local_path: string | null; file_name: string | null }[]>`select local_path, file_name from inbox_candidates where id = ${id} and deleted_at is null`
  if (!c?.local_path || !path.resolve(c.local_path).startsWith(path.resolve(INTAKE_DIR))) return new Response('לא נמצא', { status: 404 })
  const ext = path.extname(c.local_path).toLowerCase()
  const type = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : /\.jpe?g$/.test(ext) ? 'image/jpeg' : 'application/octet-stream'
  return new Response(await readFile(c.local_path), { headers: { 'content-type': type, 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(c.file_name ?? 'file')}` } })
}
