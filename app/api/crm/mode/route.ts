import { NextResponse } from 'next/server'
import { crmMode, setCrmMode } from '@/lib/crm/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ mode: await crmMode() })
}

/** המעבר: mirror → live (עובדים מכאן). חזרה ל-mirror אפשרית אם התחרטו לפני שהתחילו לעבוד כאן. */
export async function POST(req: Request) {
  let body: { mode?: string }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  if (body.mode !== 'live' && body.mode !== 'mirror') return NextResponse.json({ code: 'invalid_argument', message: 'mode חייב להיות live או mirror' }, { status: 400 })
  await setCrmMode(body.mode)
  return NextResponse.json({ mode: body.mode })
}
