import { NextResponse } from 'next/server'
import { vatLines } from '@/lib/queries/vat'

export const dynamic = 'force-dynamic'

/** שורות ה-drill של מסך 10. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  const period = p.get('period') ?? ''
  const kind = p.get('kind')
  if (!/^\d{4}-\d{2}(\/\d{2})?$/.test(period)) return NextResponse.json({ rows: [] })
  if (kind !== 'output' && kind !== 'input_claimable' && kind !== 'input_missing') return NextResponse.json({ rows: [] })
  return NextResponse.json({ rows: await vatLines(period, kind) })
}
