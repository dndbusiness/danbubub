import { describe, expect, it, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  canRead, canWrite, decodeSession, encodeSession, pwHash, restoreSecrets, sanitizeSettings, verifyLogin, SECRET_MARK, type CrmSession,
} from '@/lib/crm/auth'

beforeAll(() => { process.env.SECRETS_KEY = 'test-secret-key' })

/** הגדרות סינתטיות — אותו מבנה כמו settings/main בדף (גיבוב PBKDF2 עם מלח) */
function mkUser(username: string, pw: string, extra: Record<string, unknown> = {}) {
  const salt = randomBytes(16).toString('hex'), iter = 1000
  return { username, salt, iter, hash: pwHash(pw, salt, iter), ...extra }
}
const lockSalt = randomBytes(16).toString('hex')
const settings = {
  lock: { salt: lockSalt, iter: 1000, hash: pwHash('lock-pw', lockSalt, 1000) },
  users: [mkUser('Hadas', 'h-pw', { resp: 'hadas' }), mkUser('eden', 'e-pw', { role: 'center', divs: ['realestate'] }), { username: 'nopw', resp: 'x' }],
}

describe('verifyLogin', () => {
  it('סיסמת הנעילה בלי שם משתמש = דן, בעלים', () => {
    expect(verifyLogin(settings, '', 'lock-pw')).toMatchObject({ k: 'dan', r: 'owner' })
    expect(verifyLogin(settings, '', 'wrong')).toBeNull()
  })
  it('משתמש לפי שם (בלי תלות באותיות גדולות), תפקיד ומחלקות כמו בדף', () => {
    expect(verifyLogin(settings, 'hadas', 'h-pw')).toMatchObject({ k: 'hadas', r: 'admin', d: ['finance', 'realestate'] })
    expect(verifyLogin(settings, 'eden', 'e-pw')).toMatchObject({ k: 'eden', r: 'center', d: ['realestate'] })
    expect(verifyLogin(settings, 'eden', 'h-pw')).toBeNull()
  })
  it('משתמש בלי סיסמה מוגדרת לא נכנס', () => {
    expect(verifyLogin(settings, 'nopw', '')).toBeNull()
    expect(verifyLogin(settings, 'nopw', 'anything')).toBeNull()
  })
})

describe('session cookie', () => {
  const s: CrmSession = { k: 'dan', r: 'owner', d: ['finance'], l: 'דן', e: Date.now() + 60e3 }
  it('נחתם ונקרא חזרה', () => expect(decodeSession(encodeSession(s))).toEqual(s))
  it('חתימה מזויפת / תוכן שונה / פג תוקף — נדחים', () => {
    const t = encodeSession(s)
    expect(decodeSession(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBeNull()
    const forged = Buffer.from(JSON.stringify({ ...s, k: 'other' })).toString('base64url') + '.' + t.split('.')[1]
    expect(decodeSession(forged)).toBeNull()
    expect(decodeSession(encodeSession({ ...s, e: Date.now() - 1 }))).toBeNull()
    expect(decodeSession('')).toBeNull()
  })
})

describe('canRead / canWrite', () => {
  const center: CrmSession = { k: 'eden', r: 'center', d: ['finance'], l: '', e: 0 }
  const partner: CrmSession = { k: 'nissim', r: 'partner', d: ['finance'], l: '', e: 0 }
  const owner: CrmSession = { k: 'dan', r: 'owner', d: [], l: '', e: 0 }
  it('בלי סשן — רק settings', () => {
    expect(canRead(null, 'settings')).toBe(true)
    expect(canRead(null, 'leads')).toBe(false)
    expect(canWrite(null, 'tasks')).toBe(false)
  })
  it('מוקד: לא קורא כסף, כותב רק אוספי צוות', () => {
    expect(canRead(center, 'transactions')).toBe(false)
    expect(canRead(center, 'leads')).toBe(true)
    expect(canWrite(center, 'tasks')).toBe(true)
    expect(canWrite(center, 'clients')).toBe(false)
    expect(canWrite(center, 'settings')).toBe(false)
  })
  it('פרטי — רק הבעלים', () => {
    expect(canRead(partner, 'private')).toBe(false)
    expect(canWrite(partner, 'private')).toBe(false)
    expect(canRead(owner, 'private')).toBe(true)
  })
})

describe('sanitizeSettings / restoreSecrets', () => {
  it('גיבובים ומלחים לא יוצאים לדפדפן', () => {
    const out = JSON.stringify(sanitizeSettings(settings))
    expect(out).not.toContain('"salt"')
    expect(out).not.toContain((settings.users[0] as { hash: string }).hash)
    expect(out.match(new RegExp(`"${SECRET_MARK}"`, 'g'))?.length).toBe(3)
  })
  it('כתיבה חוזרת של מה שהדפדפן קיבל משחזרת את הגיבובים השמורים', () => {
    const back = restoreSecrets(sanitizeSettings(settings) as Record<string, unknown>, settings)
    expect(back).toEqual(settings)
  })
  it('סיסמה חדשה (גיבוב + מלח מהדף) נשמרת כמו שהיא', () => {
    const fresh = mkUser('Hadas', 'new-pw', { resp: 'hadas' })
    const incoming = { ...(sanitizeSettings(settings) as Record<string, unknown>), users: [fresh] }
    const back = restoreSecrets(incoming, settings) as { users: unknown[] }
    expect(back.users[0]).toEqual(fresh)
  })
  it('סימן בלי גיבוב שמור לא נשאר כגיבוב', () => {
    const back = restoreSecrets({ users: [{ username: 'ghost', hash: SECRET_MARK }] }, settings) as { users: Record<string, unknown>[] }
    expect(back.users[0]!.hash).toBeUndefined()
  })
})

describe('ai queue — מה נכתב ומה יוצא לדפדפן', async () => {
  const { validApply, SERVER_ONLY } = await import('@/lib/crm/ai-queue')
  const owner: CrmSession = { k: 'dan', r: 'owner', d: [], l: '', e: 0 }
  it('תשובה מהתור נכתבת רק לשדה הניתוח של הכר את הלקוח', () => {
    expect(validApply({ path: 'intakes/abc-1', field: 'ai' })).toEqual({ path: 'intakes/abc-1', field: 'ai' })
    expect(validApply({ path: 'clients/abc', field: 'ai' })).toBeNull()
    expect(validApply({ path: 'intakes/abc', field: 'status' })).toBeNull()
    expect(validApply({ path: 'intakes/../settings', field: 'ai' })).toBeNull()
    expect(validApply(null)).toBeNull()
  })
  it('התמונות והדופק לא יוצאים לדפדפן; בקשות — קריאה בלבד', () => {
    for (const c of SERVER_ONLY) expect(canRead(owner, c)).toBe(false)
    expect(canRead(owner, 'aiJobs')).toBe(true)
    expect(canWrite(owner, 'aiJobs')).toBe(false)
    expect(canWrite(owner, 'aiJobFiles')).toBe(false)
  })
})
