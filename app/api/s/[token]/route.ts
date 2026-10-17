import { NextResponse } from 'next/server'
import { finalizeEnvelope, markOpened, sendOtp, submitRequest, verifyOtp } from '@/lib/sign/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * הצד של החותם (ציבורי — הטוקן הוא ההרשאה):
 *   {action:'open'}               — הדף נפתח בדפדפן
 *   {action:'otp_send'}           — שלח קוד אימות למייל
 *   {action:'otp_verify', code}   — אימות הקוד
 *   {name, idNumber, signature, agree} — החתימה. אחרי שמירה: אם כולם חתמו — PDF → דרייב → עותקים.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > 800_000) return NextResponse.json({ ok: false, errors: ['הבקשה גדולה מדי'] }, { status: 413 })
  const body = (await req.json().catch(() => null)) as { action?: string; code?: string; name?: string; idNumber?: string; signature?: string; agree?: boolean } | null
  if (!body) return NextResponse.json({ ok: false, errors: ['בקשה לא תקינה'] }, { status: 400 })
  const now = new Date()
  // לתיעוד: מאיזה IP ומכשיר — בכל פעולה של החותם (פתיחה, קוד, חתימה)
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  const meta = { ip, ua: req.headers.get('user-agent') }
  if (body.action === 'open') return NextResponse.json({ ok: await markOpened(token, now, meta).catch(() => false) })
  if (body.action === 'otp_send') { const r = await sendOtp(token, now, meta); return NextResponse.json(r, { status: r.ok ? 200 : 422 }) }
  if (body.action === 'otp_verify') { const r = await verifyOtp(token, String(body.code ?? ''), now, meta); return NextResponse.json(r, { status: r.ok ? 200 : 422 }) }
  const r = await submitRequest(token, body, meta, now)
  if (!r.ok) return NextResponse.json(r, { status: 422 })
  // החתימה כבר נעולה ב-DB; ה-PDF והדרייב יכולים להיכשל בלי לפגוע בה (הכרטיס מציג "צור PDF שוב")
  const f = r.envelopeId ? await finalizeEnvelope(r.envelopeId, now, r.id).catch((e) => { console.error('sign finalize:', (e as Error).message); return { ok: false, complete: false, error: (e as Error).message } }) : { ok: false, complete: false }
  return NextResponse.json({ ok: true, saved: f.ok, complete: f.complete })
}
