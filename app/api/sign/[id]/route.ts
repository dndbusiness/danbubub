import { NextResponse } from 'next/server'
import { cancelEnvelope, deleteEnvelope, finalizeEnvelope, remind } from '@/lib/sign/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * פעולות הצוות: ביטול מסמך (לפני שכולם חתמו) · יצירת ה-PDF ושמירה בדרייב מחדש ·
 * תזכורת לחותם (מזהה חותם — קישור חדש, הישן מפסיק לעבוד) · מחיקה (הסתרה; מסמך פתוח מבוטל קודם).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { action?: string }
  const now = new Date()
  if (body.action === 'cancel') return NextResponse.json({ ok: await cancelEnvelope(id, now) })
  if (body.action === 'delete') return NextResponse.json({ ok: await deleteEnvelope(id, now) })
  if (body.action === 'finalize') return NextResponse.json(await finalizeEnvelope(id, now))
  if (body.action === 'remind') { const r = await remind(id, now, new URL(req.url).origin); return NextResponse.json(r, { status: r.ok ? 200 : 422 }) }
  return NextResponse.json({ code: 'invalid_argument', message: 'פעולה לא מוכרת' }, { status: 400 })
}
