import { NextResponse } from 'next/server'
import { crmSettings } from '@/lib/crm/auth'
import { leadByPhone, leadsCountByPhone, logEvent } from '@/lib/crm/voicenter'
import { bodyOf, webhookOk, webhookSecrets } from '@/lib/crm/voicenter-http'
import { field, normalizePhone, popupAnswer, popupStage } from '@/lib/rules/voicenter-cdr'

export const dynamic = 'force-dynamic'

/**
 * Pop-Up (שלב 3א): בשיחה נכנסת התוסף של וויאסנטר בכרום שואל מי מתקשר — מחזירים שם, שלב ואחראי וקישור לכרטיס.
 * מקפיצים רק ב-Ringing; בשאר השלבים (Answer / Hang up) — OK בלי כלום. רק "OK" באותיות גדולות = הצלחה.
 */
const STAGE: Record<string, string> = { new: 'חדש', noanswer: 'אין מענה', followup: 'פולו אפ', checking: 'בבדיקה', thinking: 'חושב על זה', contacted: 'נוצר קשר', meeting: 'פגישה', proposal: 'הצעה', won: 'חתם', lost: 'לא רלוונטי', ineligible: 'לא זכאי' }
const RESP: Record<string, string> = { dan: 'דן', hadas: 'הדס', nissim: 'ניסים', aviv: 'אביב' }

async function handle(req: Request) {
  if (!webhookSecrets().length) return NextResponse.json({ STATUS: 'ERROR', MESSAGE: 'not configured' }, { status: 503 })
  if (!webhookOk(req)) return NextResponse.json({ STATUS: 'ERROR', MESSAGE: 'unauthorized' }, { status: 401 })
  const b = (await bodyOf(req)) ?? {}
  const stage = popupStage(b)
  if (stage && !/ring/.test(stage)) return NextResponse.json({ STATUS: 'OK' })
  const phone = normalizePhone(field(b, 'phone', 'callerPhone', 'caller'))
  void logEvent('popup', b, new Date())
  if (phone.length < 9) return NextResponse.json({ STATUS: 'OK' })
  const lead = await leadByPhone(phone).catch(() => null)
  const s = await crmSettings().catch(() => ({})) as { users?: { resp?: string; username?: string; label?: string }[] }
  const resp = String(lead?.data.resp ?? ''), u = (s.users ?? []).find((x) => (x.resp || x.username) === resp)
  const base = (process.env.APP_BASE_URL || new URL(req.url).origin).replace(/\/+$/, '')
  return NextResponse.json(popupAnswer({ base, phone, total: lead ? await leadsCountByPhone(phone) : 0,
    lead: lead ? { id: lead.id, name: String(lead.data.name ?? '') } : null, stageLabel: lead ? STAGE[String(lead.data.stage ?? 'new')] ?? '' : '', respLabel: resp ? u?.label || RESP[resp] || resp : '' }))
}
export const POST = handle
export const GET = handle
