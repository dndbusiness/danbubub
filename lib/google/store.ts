/**
 * חיבור Google — מצב ב-integrations, הסוד ב-integration_secrets (מוצפן, lib/secrets.ts).
 * ADDENDUM ב.1: "חידוש אוטומטי; אם ההרשאה נופלת — התראה + משימה 'לחבר מחדש את גוגל'."
 */
import { sql, withActor } from '@/lib/db'
import { open, seal, secretsKey } from '@/lib/secrets'
import { GoogleAuthError, grantedScopes, oauthClientFromEnv, refreshAccessToken, type TokenResponse } from './oauth'

export interface GoogleIntegration { id: string; account_label: string; scopes: string[]; status: string; last_ok_at: string | null; last_error: string | null; connected_email: string | null; vault_secret_id: string | null }

export async function googleIntegration(): Promise<GoogleIntegration | null> {
  const [r] = await sql<GoogleIntegration[]>`
    select id, account_label, scopes, status, last_ok_at::text, last_error, connected_email, vault_secret_id
    from integrations where provider = 'google' and deleted_at is null order by created_at desc limit 1`
  return r ?? null
}

/** אחרי callback מוצלח: שומר refresh token מוצפן ומסמן connected. */
export async function connectGoogle(tokens: TokenResponse, email: string): Promise<GoogleIntegration> {
  const key = secretsKey()
  if (!key) throw new Error('SECRETS_KEY לא מוגדר — אי אפשר לשמור refresh token (הנחיה 15)')
  if (!tokens.refresh_token) throw new Error('Google לא החזיר refresh token — יש לבטל את ההרשאה בחשבון ולחבר שוב')
  const sealed = seal(tokens.refresh_token, key)
  return withActor(async (tx) => {
    const existing = await tx<{ id: string; vault_secret_id: string | null }[]>`
      select id, vault_secret_id from integrations where provider = 'google' and account_label = ${email} and deleted_at is null`
    let secretId = existing[0]?.vault_secret_id ?? null
    if (secretId) await tx`update integration_secrets set sealed = ${tx.json(sealed as never)} where id = ${secretId}`
    else secretId = (await tx<{ id: string }[]>`insert into integration_secrets (sealed) values (${tx.json(sealed as never)}) returning id`)[0]!.id
    const [row] = await tx<GoogleIntegration[]>`
      insert into integrations (provider, account_label, scopes, vault_secret_id, status, last_ok_at, last_error, connected_email)
      values ('google', ${email}, ${grantedScopes(tokens)}, ${secretId}, 'connected', now(), null, ${email})
      on conflict (provider, account_label) do update
        set scopes = excluded.scopes, vault_secret_id = excluded.vault_secret_id, status = 'connected', last_ok_at = now(), last_error = null, connected_email = excluded.connected_email
      returning id, account_label, scopes, status, last_ok_at::text, last_error, connected_email, vault_secret_id`
    return row!
  })
}

export async function disconnectGoogle(): Promise<void> {
  await withActor(async (tx) => {
    const rows = await tx<{ id: string; vault_secret_id: string | null }[]>`select id, vault_secret_id from integrations where provider = 'google' and deleted_at is null`
    for (const r of rows) {
      if (r.vault_secret_id) await tx`update integration_secrets set deleted_at = now() where id = ${r.vault_secret_id}`
      await tx`update integrations set status = 'revoked', deleted_at = now() where id = ${r.id}`
    }
  })
}

const cache = new Map<string, { token: string; expiresAt: number }>()

/**
 * access token תקף (מרענן לפי הצורך). כשל invalid_grant → status='expired' (ההתראה
 * "גוגל מנותק" נוצרת ב-alerts_eval מתוך integrations.status).
 */
export async function googleAccessToken(): Promise<string> {
  const integ = await googleIntegration()
  if (!integ || integ.status !== 'connected' || !integ.vault_secret_id) throw new Error('Google לא מחובר')
  const hit = cache.get(integ.id)
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token
  const client = oauthClientFromEnv()
  const key = secretsKey()
  if (!client || !key) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / SECRETS_KEY חסרים בסביבה')
  const [sec] = await sql<{ sealed: Parameters<typeof open>[0] }[]>`select sealed from integration_secrets where id = ${integ.vault_secret_id} and deleted_at is null`
  if (!sec) throw new Error('הסוד של החיבור לא נמצא — יש לחבר מחדש')
  try {
    const t = await refreshAccessToken(client, open(sec.sealed, key))
    cache.set(integ.id, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 })
    await sql`update integrations set last_ok_at = now(), last_error = null where id = ${integ.id}`
    return t.access_token
  } catch (e) {
    const err = e as GoogleAuthError
    await sql`update integrations set status = ${err instanceof GoogleAuthError && err.revoked ? 'expired' : 'error'}, last_error = ${err.message} where id = ${integ.id}`
    throw e
  }
}

export function hasScope(integ: GoogleIntegration | null, scope: string): boolean {
  return Boolean(integ && integ.status === 'connected' && integ.scopes.includes(scope))
}
