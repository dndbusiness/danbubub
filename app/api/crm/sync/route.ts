import { NextResponse } from 'next/server'
import { changesSince } from '@/lib/crm/store'

export const dynamic = 'force-dynamic'

/** מה השתנה במסמכי ה-CRM אחרי seq — הדף מושך את זה כל כמה שניות (במקום האזנה בזמן אמת). */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0)
  const colls = url.searchParams.get('colls')?.split(',').filter(Boolean) ?? null
  try {
    const changes = await changesSince(after, colls)
    const seq = changes.at(-1)?.seq ?? after
    return NextResponse.json({ changes, seq, more: changes.length >= 5000 })
  } catch (e) {
    return NextResponse.json({ code: 'unavailable', message: (e as Error).message }, { status: 503 })
  }
}
