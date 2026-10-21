import { NextResponse } from 'next/server'
import { cancelEnvelope, deleteEnvelope, finalizeEnvelope, markShared, remind, sendSigningSms } from '@/lib/sign/store'
import { effectiveSession } from '@/lib/crm/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * פעולות הצוות: ביטול מסמך (לפני שכולם חתמו) · יצירת ה-PDF ושמירה בדרייב מחדש ·
 * תזכורת לחותם (מזהה חותם — קישור חדש, הישן מפסיק לעבוד, ומייל) · קישור חדש בלי מייל (link — להעתקה / וואטסאפ) ·
 * מחיקה (הסתרה; מסמך פתוח מבוטל קודם) · SMS לחותם עם הקישור (sms — דרך SLNG, דן 21/10).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { action?: string; channel?: string; target?: string; url?: string }
  const now = new Date()
  if (body.action === 'shared') { const s = await effectiveSession(req); return NextResponse.json({ ok: await markShared(id, body.channel === 'whatsapp' ? 'whatsapp' : 'copy', body.target ?? null, s ? s.l || s.k : null, now) }) }
  if (body.action === 'sms') { const s = await effectiveSession(req); const r = await sendSigningSms(id, String(body.url ?? ''), s ? s.l || s.k : null, now); return NextResponse.json(r, { status: r.ok ? 200 : 422 }) }
  if (body.action === 'cancel') return NextResponse.json({ ok: await cancelEnvelope(id, now) })
  if (body.action === 'delete') return NextResponse.json({ ok: await deleteEnvelope(id, now) })
  if (body.action === 'finalize') return NextResponse.json(await finalizeEnvelope(id, now))
  if (body.action === 'remind' || body.action === 'link') { const r = await remind(id, now, new URL(req.url).origin, { email: body.action === 'remind' }); return NextResponse.json(r, { status: r.ok ? 200 : 422 }) }
  return NextResponse.json({ code: 'invalid_argument', message: 'פעולה לא מוכרת' }, { status: 400 })
}
