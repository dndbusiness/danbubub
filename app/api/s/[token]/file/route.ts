import { readStoredFile } from '@/lib/files'
import { openRequest } from '@/lib/sign/store'

export const dynamic = 'force-dynamic'

/** המסמך המקורי (טופס PDF) לחותם — הטוקן הוא ההרשאה. רק לקישור פעיל או חתום, לא לבוטל/פג. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const o = await openRequest((await params).token, new Date())
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
  if (!o || !o.envelope?.source_file_id || !['open', 'signed'].includes(o.state)) return new Response('לא נמצא', { status: 404, headers })
  const f = await readStoredFile(o.envelope.source_file_id)
  if (!f) return new Response('לא נמצא', { status: 404, headers })
  return new Response(new Uint8Array(f.bytes), { headers: { ...headers, 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="document.pdf"' } })
}
