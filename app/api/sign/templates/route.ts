import { NextResponse } from 'next/server'
import { createTemplate, listTemplates, parseTemplate } from '@/lib/sign/templates'

export const dynamic = 'force-dynamic'

/**
 * ספריית תבניות ה-PDF (מאחורי שער הכניסה).
 *   GET  ?viewer=<משתמש>  → תבניות המערכת + האישיות שלו, ו"הכי פעילות"
 *   POST                  → תבנית חדשה (קובץ שהועלה ב-/api/sign/files + שדות)
 * "viewer" מגיע מהדף: עד שתהיה כניסה אישית בשרת (שלב 10) זו העדפת תצוגה, לא הרשאה.
 */
export async function GET(req: Request) {
  const viewer = new URL(req.url).searchParams.get('viewer')
  return NextResponse.json(await listTemplates(viewer, new Date()))
}

export async function POST(req: Request) {
  const p = parseTemplate(await req.json().catch(() => null))
  if ('error' in p) return NextResponse.json({ code: 'invalid_argument', message: p.error }, { status: 400 })
  const r = await createTemplate(p.input!)
  if ('error' in r) return NextResponse.json({ code: 'invalid_argument', message: r.error }, { status: 422 })
  return NextResponse.json(r)
}
