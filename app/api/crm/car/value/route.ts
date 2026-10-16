import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { llmAvailable } from '@/lib/intake/llm'
import { costIls, dailyCapIls, reserve, settle, spendOf } from '@/lib/ai/budget'
import { CAR_VALUE_MODEL, parseValuation, runCarValuation, type CarQuery } from '@/lib/crm/car-value'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

/**
 * שווי רכב מיידי לפי מודעות יד 2 (Claude + חיפוש). נספר בתקרה היומית המשותפת של Claude API (AI_DAILY_ILS, 15 ₪).
 * GET → האם פעיל + ניצול היום. POST {maker, model, trim, year, km, hand, fuel} → הצעה בלבד; הדף מבקש אישור אדם לפני רישום.
 */
export async function GET(req: Request) {
  if (!(await effectiveSession(req))) return NextResponse.json({ enabled: false })
  const s = await spendOf()
  return NextResponse.json({ enabled: llmAvailable(), spentIls: s.ils, capIls: dailyCapIls() })
}

export async function POST(req: Request) {
  if (!(await effectiveSession(req))) return NextResponse.json({ ok: false, code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  if (!llmAvailable()) return NextResponse.json({ ok: false, code: 'not_granted', message: 'שווי מיידי לא מחובר — חסר ANTHROPIC_API_KEY בשרת' }, { status: 503 })
  let q: CarQuery
  try { q = await req.json() } catch { return NextResponse.json({ ok: false, code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  if (!q.maker || !q.model || !q.year) return NextResponse.json({ ok: false, code: 'invalid_argument', message: 'חסרים יצרן, דגם ושנתון' }, { status: 400 })
  const rv = await reserve('car_value')
  if (!rv.ok) return NextResponse.json({ ok: false, code: 'resource_exhausted', message: rv.message }, { status: 429 })
  let text = '', cost = 0, err: string | null = null
  try {
    const r = await runCarValuation({ maker: q.maker, model: q.model, trim: q.trim, year: Number(q.year) || null, km: Number(q.km) || null, hand: Number(q.hand) || null, fuel: q.fuel })
    text = r.text; cost = costIls(CAR_VALUE_MODEL, r.usages)
  } catch (e) { err = (e as Error).message }
  const day = await settle(rv.r, cost)
  if (err) return NextResponse.json({ ok: false, code: 'unavailable', message: 'הבדיקה נכשלה: ' + err, costIls: cost }, { status: 502 })
  const v = parseValuation(text)
  if (!v) return NextResponse.json({ ok: false, code: 'not_found', message: 'לא נמצאו מודעות מספיקות להערכה', costIls: cost }, { status: 404 })
  return NextResponse.json({ ok: true, valuation: v, costIls: cost, spentIls: day?.ils ?? null, capIls: dailyCapIls() })
}
