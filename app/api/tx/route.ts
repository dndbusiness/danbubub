import { NextResponse } from 'next/server'
import { txByIds } from '@/lib/queries/pnl'

/** תנועות לפי מזהים — ל-drill-down מהלקוח. */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 500)
  return NextResponse.json(await txByIds(ids))
}
