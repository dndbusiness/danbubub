import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { writeDoc } from '@/lib/crm/store'
import { crmSettings } from '@/lib/crm/auth'
import { callFromVoicenter, keyOk, phoneVariants } from '@/lib/crm/inbound'

export const dynamic = 'force-dynamic'

/**
 * וויאסנטר → CRM: כל שיחה (CDR) נרשמת בליד שהמספר שלו. מתחת לדקה = הרמה, מעל = אפקטיבית, בלי מענה = לא ענה.
 * מפתח: ?key= — VOICENTER_SECRET (הכתובת מוזנת בהגדרות ה-CDR של וויאסנטר). נציג → משתמש: settings.voicenterReps.
 */
export async function POST(req: Request) {
  const url = new URL(req.url)
  if (!process.env.VOICENTER_SECRET) return NextResponse.json({ code: 'failed_precondition', message: 'VOICENTER_SECRET לא מוגדר' }, { status: 503 })
  if (!keyOk(req.headers.get('x-api-key') ?? url.searchParams.get('key'), process.env.VOICENTER_SECRET)) return NextResponse.json({ code: 'unauthenticated' }, { status: 401 })
  let body: Record<string, unknown> = {}
  try { const ct = req.headers.get('content-type') ?? ''; body = ct.includes('json') ? await req.json() : Object.fromEntries((await req.formData()).entries()) as Record<string, unknown> }
  catch { return NextResponse.json({ code: 'invalid_argument' }, { status: 400 }) }
  const s = await crmSettings() as Record<string, unknown>
  const r = callFromVoicenter(body, (s.voicenterReps as Record<string, string>) ?? {})
  if ('error' in r) return NextResponse.json({ ok: false, message: r.error })
  const variants = r.phones.flatMap(phoneVariants)
  const [lead] = await sql<{ doc_id: string; data: { calls?: { id: string }[] } }[]>`select doc_id, data from crm_docs where coll = 'leads' and deleted_at is null
    and regexp_replace(coalesce(data->>'phone', ''), '\\D', '', 'g') = any(${variants}::text[]) order by updated_at desc limit 1`
  if (!lead) return NextResponse.json({ ok: true, matched: false })
  const calls = lead.data.calls ?? []
  if (calls.some((c) => c.id === r.call.id)) return NextResponse.json({ ok: true, matched: true, duplicate: true })
  await writeDoc('leads/' + lead.doc_id, 'update', { calls: [...calls, r.call].slice(-200) })
  return NextResponse.json({ ok: true, matched: true, lead: lead.doc_id, kind: r.call.kind })
}
