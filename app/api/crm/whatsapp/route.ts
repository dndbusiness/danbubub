import { NextResponse } from 'next/server'
import { canWrite, crmSettings, effectiveSession, sessionPerms } from '@/lib/crm/auth'
import { sendWa } from '@/lib/crm/whatsapp'
import { templateBody, templateVars, waConfig } from '@/lib/rules/wa-cloud'

export const dynamic = 'force-dynamic'

/**
 * וואטסאפ מהדף. GET → מחובר? · GET ?templates=1 → התבניות המאושרות (מ-Meta, 10 דקות במטמון)
 * POST { phone, leadId?, clientId?, text } — הודעה חופשית (רק בתוך 24 שעות מההודעה האחרונה של הלקוח)
 * POST { phone, …, template: { name, lang, params, body } } — תבנית מאושרת (בכל זמן). הכל דרך תיבת היוצא.
 */
let tplCache: { at: number; list: unknown[] } | null = null
export async function GET(req: Request) {
  const s = await effectiveSession(req); if (!s) return NextResponse.json({ enabled: false }, { status: 401 })
  const cfg = waConfig(); if (!cfg) return NextResponse.json({ enabled: false, reason: 'not_configured' })
  const u = new URL(req.url)
  if (!u.searchParams.get('templates')) return NextResponse.json({ enabled: true, webhook: !!cfg.appSecret, templates: !!cfg.wabaId })
  if (!cfg.wabaId) return NextResponse.json({ templates: [], message: 'חסר WA_WABA_ID בשרת — בלי זה אי אפשר למשוך את התבניות' })
  if (tplCache && Date.now() - tplCache.at < 10 * 60e3 && !u.searchParams.get('fresh')) return NextResponse.json({ templates: tplCache.list })
  try {
    const r = await fetch(`${cfg.base}/${cfg.version}/${cfg.wabaId}/message_templates?fields=name,language,status,category,components&limit=200`, { headers: { authorization: 'Bearer ' + cfg.token }, signal: AbortSignal.timeout(15000) })
    const j = (await r.json().catch(() => ({}))) as { data?: { name: string; language: string; status: string; category: string; components: unknown }[]; error?: { message?: string } }
    if (!r.ok) return NextResponse.json({ templates: [], message: 'Meta: ' + (j.error?.message || r.status) }, { status: 502 })
    const list = (j.data || []).filter((t) => t.status === 'APPROVED').map((t) => ({ name: t.name, lang: t.language, category: t.category, body: templateBody(t.components), vars: templateVars(t.components) }))
    tplCache = { at: Date.now(), list }; return NextResponse.json({ templates: list })
  } catch (e) { return NextResponse.json({ templates: [], message: (e as Error).message }, { status: 502 }) }
}

export async function POST(req: Request) {
  const s = await effectiveSession(req); if (!s) return NextResponse.json({ ok: false, error: 'צריך להיכנס' }, { status: 401 })
  if (!canWrite(s, 'leads', sessionPerms(s, s.r === 'owner' ? null : await crmSettings()))) return NextResponse.json({ ok: false, error: 'אין הרשאה' }, { status: 403 })
  const b = (await req.json().catch(() => null)) as { action?: string; phone?: string; leadId?: string; clientId?: string; text?: string; template?: { name: string; lang?: string; params?: string[]; body?: string } } | null
  /* בעלים: רישום האפליקציה ל-webhooks של חשבון הוואטסאפ (POST /{waba}/subscribed_apps) — פעם אחת אחרי ההגדרה */
  if (b && b.action === 'subscribe') {
    if (s.r !== 'owner') return NextResponse.json({ ok: false, error: 'רק בעלים' }, { status: 403 })
    const cfg = waConfig(); if (!cfg || !cfg.wabaId) return NextResponse.json({ ok: false, error: 'חסרים WA_CLOUD_TOKEN / WA_WABA_ID בשרת' }, { status: 412 })
    const r = await fetch(`${cfg.base}/${cfg.version}/${cfg.wabaId}/subscribed_apps`, { method: 'POST', headers: { authorization: 'Bearer ' + cfg.token }, signal: AbortSignal.timeout(15000) }).catch(() => null)
    const j = (await r?.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } } | undefined
    return NextResponse.json(r?.ok && j?.success ? { ok: true } : { ok: false, error: 'Meta: ' + (j?.error?.message || (r ? r.status : 'אין חיבור')) }, { status: r?.ok ? 200 : 502 })
  }
  if (!b || !b.phone) return NextResponse.json({ ok: false, error: 'חסר מספר' }, { status: 400 })
  const r = await sendWa({ phone: b.phone, leadId: b.leadId ?? null, clientId: b.clientId ?? null, text: b.text, template: b.template ?? null, by: s.k }, new Date())
  return NextResponse.json(r, { status: r.ok || r.status === 'queued' ? 200 : 422 })
}
