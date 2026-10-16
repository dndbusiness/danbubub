import { describe, expect, it, vi } from 'vitest'
import { GoogleAuthError, authUrl, exchangeCode, grantedScopes, missingScopes, oauthClientFromEnv, refreshAccessToken, scopesFor } from '@/lib/google/oauth.js'

const client = { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://x/api/google/callback' }

describe('Google OAuth — ADDENDUM ב.1 / הנחיה 15', () => {
  it('scopes מינימליים לפי שירות + זיהוי חשבון בלבד', () => {
    const s = scopesFor(['gmail', 'drive'])
    expect(s).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(s).toContain('https://www.googleapis.com/auth/drive.file')
    expect(s).toContain('https://www.googleapis.com/auth/userinfo.email')
    expect(s.some((x) => x.includes('calendar'))).toBe(false)
    expect(s.some((x) => x.endsWith('/auth/drive'))).toBe(false) // לא drive מלא
  })

  it('URL הרשאה: offline + consent (כדי לקבל refresh token) + state', () => {
    const u = new URL(authUrl(client, ['a', 'b'], 'nonce-1', 'dan@x'))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('scope')).toBe('a b')
    expect(u.searchParams.get('state')).toBe('nonce-1')
    expect(u.searchParams.get('login_hint')).toBe('dan@x')
  })

  it('בלי מפתחות בסביבה — אין לקוח (המסך מציג "לא מוגדר")', () => {
    expect(oauthClientFromEnv({})).toBeNull()
    expect(oauthClientFromEnv({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', APP_BASE_URL: 'https://h' })?.redirectUri).toBe('https://h/api/google/callback')
  })

  it('חילופי code → טוקנים (POST form-urlencoded)', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://oauth2.googleapis.com/token')
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('c0de')
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, token_type: 'Bearer', scope: 'a b' }))
    }) as unknown as typeof fetch
    const t = await exchangeCode(client, 'c0de', fetchImpl)
    expect(t.refresh_token).toBe('rt')
    expect(grantedScopes(t)).toEqual(['a', 'b'])
    expect(missingScopes(grantedScopes(t), ['a', 'c'])).toEqual(['c'])
  })

  it('refresh: invalid_grant = ההרשאה בוטלה → revoked', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been revoked' }), { status: 400 })) as unknown as typeof fetch
    const err = await refreshAccessToken(client, 'rt', fetchImpl).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GoogleAuthError)
    expect((err as GoogleAuthError).revoked).toBe(true)
  })
})
