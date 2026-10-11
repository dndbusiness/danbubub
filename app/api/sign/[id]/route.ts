import { NextResponse } from 'next/server'
import { cancelRequest, finalize } from '@/lib/sign/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** פעולות הצוות על בקשה: ביטול (לפני חתימה) / יצירת ה-PDF ושמירה בדרייב מחדש (אחרי חתימה). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { action?: string }
  if (body.action === 'cancel') return NextResponse.json({ ok: await cancelRequest(id, new Date()) })
  if (body.action === 'finalize') return NextResponse.json(await finalize(id, new Date()))
  return NextResponse.json({ code: 'invalid_argument', message: 'פעולה לא מוכרת' }, { status: 400 })
}
