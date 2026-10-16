import { describe, expect, it } from 'vitest'
import { open, seal, secretsKey } from '@/lib/secrets.js'

describe('סודות — הנחיה 15 (Vault / AES-GCM עם מפתח מחוץ ל-DB)', () => {
  const key = secretsKey({ SECRETS_KEY: 'dev-key' })!
  it('בלי SECRETS_KEY אין אחסון סודות', () => { expect(secretsKey({})).toBeNull() })
  it('seal/open הלוך ושוב; ה-ciphertext לא מכיל את הסוד', () => {
    const s = seal('1//refresh-token-secret', key)
    expect(s.ciphertext).not.toContain('refresh')
    expect(open(s, key)).toBe('1//refresh-token-secret')
  })
  it('מפתח אחר או שינוי בטקסט → כשל אימות (GCM), לא טקסט שגוי בשקט', () => {
    const s = seal('x', key)
    expect(() => open(s, secretsKey({ SECRETS_KEY: 'other' })!)).toThrow()
    expect(() => open({ ...s, ciphertext: Buffer.from('zz').toString('base64') }, key)).toThrow()
  })
})
