import { NextResponse } from 'next/server'
import { exchangeCode, oauthClientFromEnv, userEmail } from '@/lib/google/oauth'
import { connectGoogle } from '@/lib/google/store'

export const dynamic = 'force-dynamic'

/** ADDENDUM ב.1 — סיום OAuth: code → refresh token (מוצפן) → integrations.connected. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?${q}`, url.origin))
  const err = url.searchParams.get('error')
  if (err) return back(`google=error&reason=${encodeURIComponent(err)}`)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookie = req.headers.get('cookie')?.match(/(?:^|;\s*)g_oauth_state=([^;]+)/)?.[1]
  if (!code || !state || !cookie || cookie !== state) return back('google=error&reason=state')
  const client = oauthClientFromEnv()
  if (!client) return back('google=error&reason=no_client')
  try {
    const tokens = await exchangeCode(client, code)
    const email = await userEmail(tokens.access_token)
    await connectGoogle(tokens, email)
    const res = back(`google=connected&email=${encodeURIComponent(email)}`)
    res.cookies.set('g_oauth_state', '', { path: '/api/google', maxAge: 0 })
    return res
  } catch (e) {
    return back(`google=error&reason=${encodeURIComponent((e as Error).message)}`)
  }
}
