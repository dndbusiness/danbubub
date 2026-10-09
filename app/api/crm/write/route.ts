import { NextResponse } from 'next/server'
import { writeDoc, type WriteOp } from '@/lib/crm/store'

export const dynamic = 'force-dynamic'

/** כתיבת מסמך CRM: set / update / delete (מחיקה = deleted_at, הנחיה 4). */
export async function POST(req: Request) {
  let body: { path?: string; op?: WriteOp; data?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  if (!body.path || !['set', 'update', 'delete'].includes(String(body.op))) return NextResponse.json({ code: 'invalid_argument', message: 'חסר path או op' }, { status: 400 })
  try {
    const r = await writeDoc(body.path, body.op as WriteOp, body.data)
    return NextResponse.json(r)
  } catch (e) {
    const code = (e as { code?: string }).code
    return NextResponse.json({ code: code === 'invalid_argument' ? code : 'upstream_error', message: (e as Error).message }, { status: code === 'invalid_argument' ? 400 : 500 })
  }
}
