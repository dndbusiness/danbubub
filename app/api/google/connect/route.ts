import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { authUrl, oauthClientFromEnv, scopesFor, type GoogleService } from '@/lib/google/oauth'

export const dynamic = 'force-dynamic'

/** ADDENDUM ב.1 — התחלת OAuth. ?services=gmail,drive,calendar,sheets (ברירת מחדל: כולם). */
export async function GET(req: Request) {
  const client = oauthClientFromEnv()
  if (!client) return NextResponse.json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET לא מוגדרים בסביבת השרת' }, { status: 503 })
  const url = new URL(req.url)
  const services = (url.searchParams.get('services') ?? 'gmail,drive,calendar,sheets').split(',').filter((s): s is GoogleService => ['gmail', 'drive', 'calendar', 'sheets'].includes(s))
  const state = randomBytes(16).toString('hex')
  const res = NextResponse.redirect(authUrl(client, scopesFor(services), state, url.searchParams.get('hint') ?? undefined))
  res.cookies.set('g_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', path: '/api/google', maxAge: 600 })
  return res
}
