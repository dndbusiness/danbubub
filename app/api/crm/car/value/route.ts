import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { writeDoc } from '@/lib/crm/store'
import { effectiveSession } from '@/lib/crm/auth'
import Anthropic from '@anthropic-ai/sdk'
import { costIls, dailyCapIls, MAX_CALL_ILS, parseValuation, runCarValuation, type CarQuery } from '@/lib/crm/car-value'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

/**
 * שווי רכב מיידי לפי מודעות יד 2 (Claude + חיפוש). תקרה יומית: CAR_VALUE_DAILY_ILS (ברירת מחדל 10 ₪).
 * מפתח נפרד: CAR_VALUE_API_KEY — כדי שהתקרה תחול רק כאן, ושאר ניתוחי Claude יישארו על התור במנוי (ANTHROPIC_API_KEY היה מעביר את כולם לתשלום).
 * GET → האם פעיל + כמה נוצל היום. POST {maker, model, trim, year, km, hand, fuel} → הצעה בלבד; הדף מבקש אישור אדם לפני רישום.
 */
const dayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
interface Spend { date: string; ils: number; calls: number; last?: string }
async function spendToday(): Promise<Spend> {
  const d = dayKey(), [r] = await sql<{ data: Spend }[]>`select data from crm_docs where coll = 'aiSpend' and doc_id = ${'car-value-' + d} and deleted_at is null`
  return r?.data ?? { date: d, ils: 0, calls: 0 }
}
let busy = Promise.resolve()
const carKey = () => process.env.CAR_VALUE_API_KEY || ''

export async function GET(req: Request) {
  if (!(await effectiveSession(req))) return NextResponse.json({ enabled: false })
  const s = await spendToday()
  return NextResponse.json({ enabled: !!carKey(), spentIls: s.ils, calls: s.calls, capIls: dailyCapIls() })
}

export async function POST(req: Request) {
  const session = await effectiveSession(req)
  if (!session) return NextResponse.json({ ok: false, code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  if (!carKey()) return NextResponse.json({ ok: false, code: 'not_granted', message: 'שווי מיידי לא מחובר — חסר CAR_VALUE_API_KEY בשרת' }, { status: 503 })
  let q: CarQuery
  try { q = await req.json() } catch { return NextResponse.json({ ok: false, code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  if (!q.maker || !q.model || !q.year) return NextResponse.json({ ok: false, code: 'invalid_argument', message: 'חסרים יצרן, דגם ושנתון' }, { status: 400 })
  /* בקשה אחת בכל פעם — כדי שהתקרה תיבדק לפני כל קריאה */
  const prev = busy; let release!: () => void; busy = new Promise((r) => { release = r }); await prev
  try {
    const cap = dailyCapIls(), s0 = await spendToday()
    if (s0.ils + MAX_CALL_ILS > cap) return NextResponse.json({ ok: false, code: 'resource_exhausted', message: `הגענו לתקרה היומית (${s0.ils.toFixed(2)} מתוך ${cap} ₪). מחר שוב, או להזין ידנית.` }, { status: 429 })
    let text = '', usages: Parameters<typeof costIls>[0] = [], err: string | null = null
    try { ({ text, usages } = await runCarValuation({ maker: q.maker, model: q.model, trim: q.trim, year: Number(q.year) || null, km: Number(q.km) || null, hand: Number(q.hand) || null, fuel: q.fuel }, new Anthropic({ apiKey: carKey() }))) }
    catch (e) { err = (e as Error).message }
    const cost = costIls(usages), s1 = await spendToday()
    await writeDoc('aiSpend/car-value-' + s1.date, 'set', { date: s1.date, ils: Math.round((s1.ils + cost) * 100) / 100, calls: s1.calls + 1, last: new Date().toISOString() })
    if (err) return NextResponse.json({ ok: false, code: 'unavailable', message: 'הבדיקה נכשלה: ' + err, costIls: cost }, { status: 502 })
    const v = parseValuation(text)
    if (!v) return NextResponse.json({ ok: false, code: 'not_found', message: 'לא נמצאו מודעות מספיקות להערכה', costIls: cost, raw: text.slice(0, 600) }, { status: 404 })
    return NextResponse.json({ ok: true, valuation: v, costIls: cost, spentIls: Math.round((s1.ils + cost) * 100) / 100, capIls: cap })
  } finally { release() }
}
