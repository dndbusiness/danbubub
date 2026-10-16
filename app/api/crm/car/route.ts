import { NextResponse } from 'next/server'
import { lookupCar } from '@/lib/crm/car-registry'

export const dynamic = 'force-dynamic'

/** פרטי רכב לפי מספר רישוי (משרד התחבורה, data.gov.il) — מאחורי שער המשרד כמו כל /api/crm */
export async function GET(req: Request) {
  const r = await lookupCar(new URL(req.url).searchParams.get('plate'))
  if (!r.ok) return NextResponse.json(r, { status: r.code === 'invalid_argument' ? 400 : r.code === 'not_found' ? 404 : 502 })
  return NextResponse.json(r)
}
