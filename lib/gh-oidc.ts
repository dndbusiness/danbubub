import { createPublicKey, verify, type JsonWebKey } from 'node:crypto'

/**
 * הרשאה לג'ובים ולשומר מ-GitHub Actions בלי סוד משותף (18/10).
 * כל ריצה ב-GitHub מקבלת אסימון זהות חתום (OIDC) שאומר מאיזה מאגר ומאיזה ענף היא רצה. השרת בודק את החתימה
 * מול המפתחות הציבוריים של GitHub — אין מה להדביק ב-Vercel או ב-GitHub Secrets, ואין ערך שיכול לא להתאים.
 * מקובל רק אסימון של המאגר הזה, מהענף main, לקהל ההר-אל. מזלג (fork) או PR לא מקבלים אסימון כזה.
 */
export const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
export const OIDC_AUDIENCE = 'harel-jobs'
export const OIDC_REPO = 'dndbusiness/danbubub'
const JWKS_URL = OIDC_ISSUER + '/.well-known/jwks'

export interface OidcClaims { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; iat?: number; repository?: string; ref?: string; event_name?: string; workflow_ref?: string }
export type OidcResult = { ok: true; claims: OidcClaims } | { ok: false; reason: string }

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/** בדיקה טהורה: חתימה (RS256) מול jwks, מנפיק, קהל, תוקף, מאגר וענף. now בשניות. */
export function verifyOidc(token: string, jwks: { keys: (JsonWebKey & { kid?: string })[] }, now: number, want = { repo: OIDC_REPO, audience: OIDC_AUDIENCE, ref: 'refs/heads/main' }): OidcResult {
  const parts = String(token || '').trim().split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  let header: { alg?: string; kid?: string }, claims: OidcClaims
  try { header = JSON.parse(b64url(parts[0]!).toString('utf8')); claims = JSON.parse(b64url(parts[1]!).toString('utf8')) } catch { return { ok: false, reason: 'malformed' } }
  if (header.alg !== 'RS256') return { ok: false, reason: 'alg' }
  const jwk = jwks.keys.find((k) => k.kid === header.kid)
  if (!jwk) return { ok: false, reason: 'unknown_key' }
  let good = false
  try { good = verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]!)) } catch { good = false }
  if (!good) return { ok: false, reason: 'signature' }
  if (claims.iss !== OIDC_ISSUER) return { ok: false, reason: 'issuer' }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(want.audience)) return { ok: false, reason: 'audience' }
  if (typeof claims.exp !== 'number' || claims.exp < now - 30) return { ok: false, reason: 'expired' }
  if (typeof claims.nbf === 'number' && claims.nbf > now + 30) return { ok: false, reason: 'not_yet_valid' }
  if (String(claims.repository || '').toLowerCase() !== want.repo.toLowerCase()) return { ok: false, reason: 'repository' }
  if (claims.ref !== want.ref) return { ok: false, reason: 'ref' }
  return { ok: true, claims }
}

let cache: { at: number; jwks: { keys: (JsonWebKey & { kid?: string })[] } } | null = null
async function jwks(force = false) {
  if (!force && cache && Date.now() - cache.at < 3600e3) return cache.jwks
  const r = await fetch(JWKS_URL, { cache: 'no-store' })
  if (!r.ok) throw new Error('jwks ' + r.status)
  cache = { at: Date.now(), jwks: await r.json() }
  return cache.jwks
}

/** האסימון מהכותרת x-gh-oidc. מפתח לא מוכר — מרעננים את המפתחות פעם אחת (GitHub מחליף אותם מדי פעם). */
export async function githubOidc(req: Request): Promise<OidcResult> {
  const token = (req.headers.get('x-gh-oidc') ?? '').trim()
  if (!token) return { ok: false, reason: 'missing' }
  try {
    const now = Math.floor(Date.now() / 1000)
    let r = verifyOidc(token, await jwks(), now)
    if (!r.ok && r.reason === 'unknown_key') r = verifyOidc(token, await jwks(true), now)
    return r
  } catch { return { ok: false, reason: 'jwks_unavailable' } }
}
