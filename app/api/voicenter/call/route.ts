import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { crmSettings, effectiveSession } from '@/lib/crm/auth'
import { CLICK2CALL_URL, dialable, extOf } from '@/lib/rules/voicenter'
import { click2callBody, click2callResult } from '@/lib/rules/voicenter-cdr'

export const dynamic = 'force-dynamic'

/**
 * Click2Call (שלב 2): "חייג מהמרכזייה" — השלוחה של מי שנכנס מצלצלת, וכשהוא עונה המרכזייה מחייגת ללקוח.
 * GET → פעיל למי שנכנס? (VOICENTER_CODE + שלוחה בהגדרות) · POST { leadId | clientId | phone } · POST { action: 'terminate' } — ניתוק.
 * var_leadId / var_userId חוזרים ב-CDR — השיחה נרשמת בוודאות בליד הנכון. הקוד של החשבון לא יוצא לדפדפן.
 */
export async function GET(req: Request) {
  const s = await effectiveSession(req)
  if (!s || !process.env.VOICENTER_CODE) return NextResponse.json({ enabled: false, reason: process.env.VOICENTER_CODE ? 'login' : 'code' })
  const ext = extOf(await crmSettings() as never, s.k)
  return NextResponse.json({ enabled: !!ext, ext, reason: ext ? null : 'ext' })
}

async function phoneOf(coll: 'leads' | 'clients', id: string): Promise<string | null> {
  const [r] = await sql<{ phone: string | null }[]>`select data->>'phone' as phone from crm_docs where coll = ${coll} and doc_id = ${id} and deleted_at is null`
  return r?.phone ?? null
}

export async function POST(req: Request) {
  const s = await effectiveSession(req)
  if (!s) return NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  const code = process.env.VOICENTER_CODE
  if (!code) return NextResponse.json({ code: 'failed_precondition', message: 'המרכזייה לא מחוברת (חסר קוד וויאסנטר בשרת)' }, { status: 412 })
  const body = (await req.json().catch(() => null)) as { phone?: string; leadId?: string; clientId?: string; action?: string } | null
  if (!body) return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 })
  const ext = extOf(await crmSettings() as never, s.k)
  if (!ext) return NextResponse.json({ code: 'failed_precondition', message: 'לא הוגדרה לך שלוחה (הגדרות ← משתמשים ← שלוחה במרכזייה)' }, { status: 412 })
  const post = async (payload: Record<string, string>) => {
    const r = await fetch(CLICK2CALL_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) })
    return click2callResult(r.status, await r.text())
  }
  try {
    if (body.action === 'terminate') {
      const r = await post({ code, action: 'terminate', phone: ext, format: 'json' })
      return NextResponse.json({ ok: r.ok || r.code === null, message: r.ok ? 'השיחה נותקה' : r.message })
    }
    const target = dialable(body.phone ?? (body.leadId ? await phoneOf('leads', body.leadId) : body.clientId ? await phoneOf('clients', body.clientId) : null))
    if (!target) return NextResponse.json({ code: 'invalid_argument', message: 'אין מספר טלפון תקין' }, { status: 400 })
    const r = await post(click2callBody(code, ext, target, { leadId: body.leadId ?? '', clientId: body.clientId ?? '', userId: s.k }))
    return r.ok ? NextResponse.json({ ok: true, ext, callId: r.callId, message: r.message }) : NextResponse.json({ code: 'upstream_error', message: r.message, vcCode: r.code }, { status: 502 })
  } catch (e) {
    return NextResponse.json({ code: 'unavailable', message: 'המרכזייה לא ענתה: ' + (e as Error).message }, { status: 503 })
  }
}
