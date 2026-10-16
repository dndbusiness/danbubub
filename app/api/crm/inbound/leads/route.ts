import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { writeDoc } from '@/lib/crm/store'
import { crmSettings } from '@/lib/crm/auth'
import { keyOk, leadFromPayload, phoneVariants } from '@/lib/crm/inbound'

export const dynamic = 'force-dynamic'

/**
 * לידים ממערכות חיצוניות (פייסבוק דרך Zapier/Make, דפי נחיתה, משווקים): POST עם JSON או טופס.
 * מפתח: כותרת x-api-key או ?key= — LEADS_API_KEY. אותו טלפון שכבר נכנס ב-10 הדקות האחרונות = אותו ליד.
 */
export async function POST(req: Request) {
  const url = new URL(req.url)
  if (!process.env.LEADS_API_KEY) return NextResponse.json({ code: 'failed_precondition', message: 'LEADS_API_KEY לא מוגדר' }, { status: 503 })
  if (!keyOk(req.headers.get('x-api-key') ?? url.searchParams.get('key'), process.env.LEADS_API_KEY)) return NextResponse.json({ code: 'unauthenticated', message: 'מפתח שגוי' }, { status: 401 })
  let body: Record<string, unknown> = {}
  try {
    const ct = req.headers.get('content-type') ?? ''
    body = ct.includes('json') ? await req.json() : Object.fromEntries((await req.formData()).entries()) as Record<string, unknown>
  } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא נקרא' }, { status: 400 }) }
  for (const [k, v] of url.searchParams) if (k !== 'key' && body[k] == null) body[k] = v
  const s = await crmSettings() as Record<string, unknown>
  const r = leadFromPayload(body, new Date(), { defaultResp: (s.defaultResp as Record<string, string | null>) ?? undefined })
  if ('error' in r) return NextResponse.json({ code: 'invalid_argument', message: r.error }, { status: 400 })
  const phone = String(r.doc.phone || '')
  if (phone) {
    const [dup] = await sql<{ doc_id: string }[]>`select doc_id from crm_docs where coll = 'leads' and deleted_at is null
      and regexp_replace(coalesce(data->>'phone', ''), '\\D', '', 'g') = any(${phoneVariants(phone)}::text[]) and updated_at > now() - interval '10 minutes' limit 1`
    if (dup) return NextResponse.json({ ok: true, id: dup.doc_id, duplicate: true })
  }
  const [ex] = await sql<{ doc_id: string }[]>`select doc_id from crm_docs where coll = 'leads' and doc_id = ${r.id}`
  if (ex) return NextResponse.json({ ok: true, id: r.id, duplicate: true })
  await writeDoc('leads/' + r.id, 'set', r.doc)
  return NextResponse.json({ ok: true, id: r.id })
}
