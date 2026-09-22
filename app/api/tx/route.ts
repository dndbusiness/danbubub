import { NextResponse } from 'next/server'
import { txByIds } from '@/lib/queries/pnl'
import { unassignedIncome } from '@/lib/queries/collections'

export const dynamic = 'force-dynamic'

/** תנועות לפי מזהים (drill-down), או מועמדי שיוך ל"סמן שולם" (ב.6). */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  const unassigned = p.get('unassigned')
  if (unassigned !== null) {
    const amount = Number(unassigned)
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ rows: [] })
    return NextResponse.json({ rows: await unassignedIncome(amount) })
  }
  const ids = (p.get('ids') ?? '').split(',').filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 500)
  return NextResponse.json(await txByIds(ids))
}
