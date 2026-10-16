import { NextResponse } from 'next/server'
import { deleteTemplate, getTemplate, parseTemplate, updateTemplate } from '@/lib/sign/templates'

export const dynamic = 'force-dynamic'

/** תבנית אחת: קריאה · עדכון (שם, תיקייה, שדות…) · מחיקה (הסתרה; מסמכים שנשלחו ממנה לא נפגעים). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await getTemplate((await params).id)
  return t ? NextResponse.json(t) : NextResponse.json({ code: 'not_found', message: 'לא נמצא' }, { status: 404 })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = parseTemplate(await req.json().catch(() => null))
  if ('error' in p) return NextResponse.json({ code: 'invalid_argument', message: p.error }, { status: 400 })
  const r = await updateTemplate((await params).id, p.input!)
  return 'error' in r ? NextResponse.json({ code: 'invalid_argument', message: r.error }, { status: 422 }) : NextResponse.json(r)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return NextResponse.json({ ok: await deleteTemplate((await params).id, new Date()) })
}
