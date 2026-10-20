import { NextResponse } from 'next/server'
import { handleCdr, logEvent, markEvent } from '@/lib/crm/voicenter'
import { bodyOf, webhookOk, webhookSecrets } from '@/lib/crm/voicenter-http'

export const dynamic = 'force-dynamic'

/**
 * וויאסנטר → CDR (שלב 1, docs/VOICENTER.md): כל שיחה שהסתיימה נרשמת — calls/<ivruniqueid>, בכרטיס הליד,
 * ליד חדש משיחה נכנסת ממספר לא מוכר, ומשימת חזרה על נכנסת שלא נענתה.
 * הכתובת: /api/voicenter/cdr?key=<VOICENTER_WEBHOOK_SECRET>. וויאסנטר מצפה ל-200 עם {"Err":0,"Errdesc":"OK"}.
 */
export async function POST(req: Request) {
  if (!webhookSecrets().length) return NextResponse.json({ Err: 2, Errdesc: 'not configured' }, { status: 503 })
  if (!webhookOk(req)) return NextResponse.json({ Err: 1, Errdesc: 'unauthorized' }, { status: 401 })
  const now = new Date()
  const body = await bodyOf(req)
  const ev = await logEvent('cdr', body ?? { unparsed: true }, now)
  if (!body) { await markEvent(ev, false, { error: 'parse' }); return NextResponse.json({ Err: 1, Errdesc: 'parse error' }) }
  try {
    const r = await handleCdr(body, now)
    await markEvent(ev, r.ok, r.ok ? { result: r } : { error: r.error })
    return NextResponse.json(r.ok ? { Err: 0, Errdesc: 'OK' } : { Err: 1, Errdesc: r.error })
  } catch (e) {
    await markEvent(ev, false, { error: (e as Error).message.slice(0, 300) })
    return NextResponse.json({ Err: 2, Errdesc: 'internal error' })
  }
}
