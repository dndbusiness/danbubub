import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { llmAvailable } from '@/lib/intake/llm'
import { enqueue, queueAlive } from '@/lib/crm/ai-queue'
import { costIls, dailyCapIls, reserve, settle } from '@/lib/ai/budget'
import { PROPERTY_VALUE_MODEL, paidEnabled, parsePropertySearch, runPropertySearch, valSearchPrompt, type PropSubject } from '@/lib/crm/property-value'

export const dynamic = 'force-dynamic'
export const maxDuration = 240

/**
 * הערכת שווי נכס — חיפוש נתוני שוק (docs/HAREL_VALUATION_SPEC.md §13).
 * GET → אילו דרכים פתוחות. POST {address, type, rooms, area, floor, kind, gush, helka}:
 *   · התור על המנוי חי → {job} (הדף מושך את הסטטוס ב-GET /api/crm/sample?job=). חינם, תוך דקות. ברירת המחדל (דן, 16/10).
 *   · התור לא חי, ו-PROPERTY_VALUE_PAID=1 + מפתח → API עם חיפוש, בתוך התקרה היומית המשותפת → {result}.
 *   · אחרת 503 — הדף מציע הזנה או הדבקה ידנית.
 * אף פעם לא דרך sample הכללי: שם אין חיפוש באינטרנט, ו-Claude היה ממציא עסקאות.
 */
export async function GET(req: Request) {
  if (!(await effectiveSession(req))) return NextResponse.json({ queue: false, paid: false })
  return NextResponse.json({ queue: await queueAlive().catch(() => false), paid: paidEnabled() && llmAvailable(), capIls: dailyCapIls() })
}

export async function POST(req: Request) {
  const session = await effectiveSession(req)
  if (!session) return NextResponse.json({ ok: false, code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  let b: PropSubject
  try { b = await req.json() } catch { return NextResponse.json({ ok: false, code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null }
  const s: PropSubject = { address: String(b.address ?? '').slice(0, 160), type: String(b.type ?? '').slice(0, 20), rooms: num(b.rooms), area: num(b.area), floor: b.floor == null || String(b.floor) === '' ? null : Number(b.floor), kind: b.kind === 'new' || b.kind === 'second' ? b.kind : '', gush: String(b.gush ?? '').replace(/\D/g, '').slice(0, 8), helka: String(b.helka ?? '').replace(/\D/g, '').slice(0, 6) }
  if (s.address!.trim().length < 4) return NextResponse.json({ ok: false, code: 'invalid_argument', message: 'חסרה כתובת' }, { status: 400 })

  if (await queueAlive().catch(() => false)) {
    const job = await enqueue(session, { turns: [{ role: 'user', content: valSearchPrompt(s) }], modelTier: 'default', json: true, images: [], label: 'שווי נכס — ' + s.address })
    return NextResponse.json({ ok: true, job: job.id })
  }
  if (!paidEnabled() || !llmAvailable()) return NextResponse.json({ ok: false, code: 'not_granted', message: 'החיפוש עובד דרך התור של Claude על המנוי, והוא לא פעיל עכשיו. אפשר להזין או להדביק עסקאות ידנית.' }, { status: 503 })
  const rv = await reserve('property_value')
  if (!rv.ok) return NextResponse.json({ ok: false, code: 'resource_exhausted', message: rv.message }, { status: 429 })
  let text = '', cost = 0, err: string | null = null
  try { const r = await runPropertySearch(s); text = r.text; cost = costIls(PROPERTY_VALUE_MODEL, r.usages) } catch (e) { err = (e as Error).message }
  await settle(rv.r, cost)
  if (err) return NextResponse.json({ ok: false, code: 'unavailable', message: 'החיפוש נכשל: ' + err, costIls: cost }, { status: 502 })
  const result = parsePropertySearch(text)
  if (!result) return NextResponse.json({ ok: false, code: 'not_found', message: 'לא התקבלה תשובה תקינה', costIls: cost }, { status: 404 })
  return NextResponse.json({ ok: true, result, costIls: cost })
}
