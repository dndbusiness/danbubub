import { readStoredFile } from '@/lib/files'

export const dynamic = 'force-dynamic'

/** קובץ שנשמר במסד (stored_files) — מאחורי שער הכניסה. קישור קבוע לדוח שלא עלה לדרייב. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const f = await readStoredFile(id)
  if (!f) return new Response('לא נמצא', { status: 404 })
  return new Response(new Uint8Array(f.bytes), { headers: { 'content-type': f.mime, 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'cache-control': 'private, no-store' } })
}
