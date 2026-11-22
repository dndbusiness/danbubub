import { NextResponse } from 'next/server'
import { handleWaWebhook, logWaEvent } from '@/lib/crm/whatsapp'
import { signatureOk, waConfig } from '@/lib/rules/wa-cloud'

export const dynamic = 'force-dynamic'

/**
 * וואטסאפ (Cloud API) → ה-CRM. הכתובת שמזינים ב-Meta: https://<האתר>/api/whatsapp/webhook
 * GET — אימות ההרשמה (hub.verify_token = WA_VERIFY_TOKEN). POST — הודעות וסטטוסים, חתומים ב-X-Hub-Signature-256 עם WA_APP_SECRET.
 * תמיד 200 על בקשה חתומה — אחרת Meta מנסה שוב ובסוף מכבה את ה-webhook. docs/WHATSAPP.md
 */
export async function GET(req: Request) {
  const u = new URL(req.url), cfg = waConfig()
  if (u.searchParams.get('hub.mode') === 'subscribe' && cfg?.verify && u.searchParams.get('hub.verify_token') === cfg.verify) return new NextResponse(u.searchParams.get('hub.challenge') ?? '', { status: 200, headers: { 'content-type': 'text/plain' } })
  return NextResponse.json({ ok: false }, { status: 403 })
}


export async function POST(req: Request) {
  const cfg = waConfig(); if (!cfg || !cfg.appSecret) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 })
  const raw = await req.text()
  if (!signatureOk(raw, req.headers.get('x-hub-signature-256'), cfg.appSecret)) return NextResponse.json({ ok: false }, { status: 401 })
  const now = new Date(); let body: unknown = null
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }
  await logWaEvent(body, now)
  try { return NextResponse.json(await handleWaWebhook(body, now)) } catch (e) { console.error('wa webhook:', (e as Error).message); return NextResponse.json({ ok: true, error: 'internal' }) }
}
