import { NextResponse } from 'next/server'
import { handleCdr, logEvent, markEvent } from '@/lib/crm/voicenter'
import { bodyOf, webhookOk, webhookSecrets } from '@/lib/crm/voicenter-http'

export const dynamic = 'force-dynamic'

/** הכתובת הקודמת של ה-CDR (VOICENTER_SECRET) — אותו עיבוד כמו /api/voicenter/cdr, כדי שהגדרה קיימת לא תישבר */
export async function POST(req: Request) {
  if (!webhookSecrets().length) return NextResponse.json({ code: 'failed_precondition', message: 'VOICENTER_WEBHOOK_SECRET לא מוגדר' }, { status: 503 })
  if (!webhookOk(req)) return NextResponse.json({ code: 'unauthenticated' }, { status: 401 })
  const now = new Date(), body = await bodyOf(req)
  if (!body) return NextResponse.json({ code: 'invalid_argument' }, { status: 400 })
  const ev = await logEvent('cdr', body, now)
  const r = await handleCdr(body, now)
  await markEvent(ev, r.ok, r.ok ? { result: r } : { error: r.error })
  return NextResponse.json({ ok: r.ok, matched: !!r.lead, lead: r.lead, duplicate: r.duplicate, ...(r.error ? { message: r.error } : {}) })
}
