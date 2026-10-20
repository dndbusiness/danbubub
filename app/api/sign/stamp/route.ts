import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { writeDoc } from '@/lib/crm/store'
import { storeFile } from '@/lib/files'
import { currentStampId, stampDataUrl } from '@/lib/sign/stamp'

export const dynamic = 'force-dynamic'

/** חותמת החברה: GET — התמונה הנוכחית (לתצוגה בהגדרות) · POST { png: dataURL } — דן מעלה חותמת חדשה. */
export async function GET(req: Request) {
  const s = await effectiveSession(req)
  if (!s || s.r !== 'owner') return NextResponse.json({ code: 'permission_denied' }, { status: 403 })
  return NextResponse.json({ url: await stampDataUrl(await currentStampId()) })
}

export async function POST(req: Request) {
  const s = await effectiveSession(req)
  if (!s || s.r !== 'owner') return NextResponse.json({ code: 'permission_denied', message: 'רק דן' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { png?: string }
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.png ?? ''))
  if (!m) return NextResponse.json({ code: 'invalid_argument', message: 'צריך תמונת PNG' }, { status: 400 })
  const bytes = Buffer.from(m[1]!, 'base64')
  if (bytes.length < 200 || bytes.length > 1_500_000) return NextResponse.json({ code: 'invalid_argument', message: 'התמונה קטנה מדי או גדולה מ-1.5MB' }, { status: 400 })
  const fileId = await storeFile(bytes, 'חותמת החברה.png', 'image/png', 'sign')
  await writeDoc('settings/main', 'update', { companyStamp: { fileId, at: new Date().toISOString(), by: s.l || s.k } })
  return NextResponse.json({ ok: true, fileId })
}
