/**
 * OAuth 2.0 של המשתמש מול Google — ADDENDUM ב.1 / הנחיה 15.
 * "OAuth משתמש (לא service account) … scopes מינימליים … refresh token ב-Vault."
 * כאן רק בניית URL וחילופי טוקנים (fetch, ניתן להזרקה לבדיקות). האחסון — lib/google/store.ts.
 */

export const GOOGLE_SCOPES = {
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
  drive: ['https://www.googleapis.com/auth/drive.file'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  /** לזיהוי החשבון שחובר (account_label) בלבד. */
  identity: ['https://www.googleapis.com/auth/userinfo.email'],
} as const

export type GoogleService = keyof typeof GOOGLE_SCOPES

export interface OAuthClient { clientId: string; clientSecret: string; redirectUri: string }

export function oauthClientFromEnv(env: Record<string, string | undefined> = process.env): OAuthClient | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null
  const base = env.APP_BASE_URL ?? 'http://localhost:3000'
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI ?? `${base}/api/google/callback` }
}

/** ה-scopes המינימליים לשירותים שנבחרו (ב.1 — רק מה שצריך). */
export function scopesFor(services: readonly GoogleService[]): string[] {
  const set = new Set<string>(GOOGLE_SCOPES.identity)
  for (const s of services) for (const scope of GOOGLE_SCOPES[s]) set.add(scope)
  return [...set]
}

export function authUrl(client: OAuthClient, scopes: readonly string[], state: string, loginHint?: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', client.clientId)
  u.searchParams.set('redirect_uri', client.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', scopes.join(' '))
  u.searchParams.set('access_type', 'offline')   // refresh token
  u.searchParams.set('prompt', 'consent')        // מבטיח refresh token גם בחיבור חוזר
  u.searchParams.set('include_granted_scopes', 'true')
  u.searchParams.set('state', state)
  if (loginHint) u.searchParams.set('login_hint', loginHint)
  return u.toString()
}

export interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string; scope?: string; token_type: string; id_token?: string }

async function tokenRequest(body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(),
  })
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string }
  if (!res.ok || !data.access_token) throw new GoogleAuthError(data.error ?? `HTTP ${res.status}`, data.error_description)
  return data
}

export class GoogleAuthError extends Error {
  constructor(public code: string, description?: string) { super(`Google OAuth: ${code}${description ? ` — ${description}` : ''}`) }
  /** invalid_grant = ההרשאה בוטלה/פגה → integrations.status='expired' + התראה (ב.1). */
  get revoked(): boolean { return this.code === 'invalid_grant' }
}

export function exchangeCode(client: OAuthClient, code: string, fetchImpl: typeof fetch = fetch): Promise<TokenResponse> {
  return tokenRequest({ code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: client.redirectUri, grant_type: 'authorization_code' }, fetchImpl)
}

export function refreshAccessToken(client: OAuthClient, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<TokenResponse> {
  return tokenRequest({ refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'refresh_token' }, fetchImpl)
}

export async function userEmail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new GoogleAuthError(`userinfo ${res.status}`)
  const data = (await res.json()) as { email?: string }
  if (!data.email) throw new GoogleAuthError('no_email')
  return data.email
}

/** scopes שהמשתמש אישר בפועל (Google עשוי לתת פחות ממה שביקשנו). */
export function grantedScopes(token: TokenResponse): string[] {
  return (token.scope ?? '').split(' ').filter(Boolean)
}

export function missingScopes(granted: readonly string[], wanted: readonly string[]): string[] {
  return wanted.filter((s) => !granted.includes(s))
}
