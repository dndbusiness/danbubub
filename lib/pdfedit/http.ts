import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { DriveDirectError } from '@/lib/crm/drive-direct'
import { PdfEditError } from './engine'

/** עורך ה-PDF — שער הכניסה ותרגום שגיאות לתשובה (אותו מבנה כמו /api/crm/drive). */
export async function guard(req: Request): Promise<NextResponse | null> {
  return (await effectiveSession(req)) ? null : NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
}
export function errOut(e: unknown): NextResponse {
  const code = e instanceof PdfEditError || e instanceof DriveDirectError ? e.code : 'internal'
  const status = code === 'not_granted' ? 403 : code === 'not_found' ? 404 : code === 'invalid_argument' ? 400 : code === 'server_not_connected' ? 409 : code === 'internal' ? 500 : 502
  if (code === 'internal') console.error('[pdfedit]', e)
  return NextResponse.json({ code, message: code === 'internal' ? 'עיבוד ה-PDF נכשל: ' + String((e as Error)?.message ?? e).slice(0, 200) : (e as Error).message }, { status })
}
