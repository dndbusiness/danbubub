import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyOidc } from '@/lib/gh-oidc'

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] }
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const NOW = 1_800_000_000
const base = { iss: 'https://token.actions.githubusercontent.com', aud: 'harel-jobs', repository: 'dndbusiness/danbubub', ref: 'refs/heads/main', iat: NOW - 10, nbf: NOW - 10, exp: NOW + 300 }
function jwt(claims: object, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) {
  const h = enc({ alg, kid, typ: 'JWT' }), p = enc(claims)
  return h + '.' + p + '.' + sign('RSA-SHA256', Buffer.from(h + '.' + p), key).toString('base64url')
}

describe('אסימון OIDC של GitHub Actions לג׳ובים (18/10)', () => {
  it('אסימון תקין מהמאגר, מ-main, לקהל הנכון — עובר', () => {
    expect(verifyOidc(jwt(base), jwks, NOW)).toMatchObject({ ok: true })
  })
  it.each([
    ['repository', { repository: 'someone/fork' }],
    ['ref', { ref: 'refs/heads/feature' }],
    ['ref', { ref: 'refs/pull/5/merge' }],
    ['audience', { aud: 'other' }],
    ['issuer', { iss: 'https://evil.example' }],
    ['expired', { exp: NOW - 100 }],
  ])('נדחה: %s', (reason, patch) => {
    expect(verifyOidc(jwt({ ...base, ...patch }), jwks, NOW)).toEqual({ ok: false, reason })
  })
  it('חתימה של מפתח אחר / אסימון ששונה / מפתח לא מוכר / פורמט — נדחים', () => {
    expect(verifyOidc(jwt(base, { key: other.privateKey }), jwks, NOW)).toEqual({ ok: false, reason: 'signature' })
    const t = jwt(base).split('.'); t[1] = enc({ ...base, repository: 'dndbusiness/danbubub', ref: 'refs/heads/x' })
    expect(verifyOidc(t.join('.'), jwks, NOW)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyOidc(jwt(base, { kid: 'nope' }), jwks, NOW)).toEqual({ ok: false, reason: 'unknown_key' })
    expect(verifyOidc(jwt(base, { alg: 'none' }), jwks, NOW)).toEqual({ ok: false, reason: 'alg' })
    expect(verifyOidc('abc', jwks, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })
})
