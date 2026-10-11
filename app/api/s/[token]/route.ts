import { NextResponse } from 'next/server'
import { finalize, submitRequest } from '@/lib/sign/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** הלקוח שולח חתימה (ציבורי — הטוקן הוא ההרשאה). אחרי שמירה: PDF → דרייב → התראות. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > 800_000) return NextResponse.json({ ok: false, errors: ['הבקשה גדולה מדי'] }, { status: 413 })
  const body = (await req.json().catch(() => null)) as { name?: string; idNumber?: string; signature?: string; agree?: boolean } | null
  if (!body) return NextResponse.json({ ok: false, errors: ['בקשה לא תקינה'] }, { status: 400 })
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  const now = new Date()
  const r = await submitRequest(token, body, { ip, ua: req.headers.get('user-agent') }, now)
  if (!r.ok) return NextResponse.json(r, { status: 422 })
  // השמירה כבר נעולה ב-DB; ה-PDF והדרייב יכולים להיכשל בלי לפגוע בחתימה (הכרטיס מציג "צור PDF שוב")
  const f = await finalize(r.id, now).catch((e) => ({ ok: false, error: (e as Error).message }))
  return NextResponse.json({ ok: true, saved: f.ok })
}
