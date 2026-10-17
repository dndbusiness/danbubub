import { describe, expect, it, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  canRead, canWrite, decodeSession, encodeSession, pwHash, restoreSecrets, sanitizeSettings, verifyLogin, SECRET_MARK, type CrmSession,
  permsOf, sessionPerms, guardPerms, AREAS, DAN_GRANT, isOwnerSession, memberId, pickMember,
} from '@/lib/crm/auth'
import { readFileSync } from 'node:fs'

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
  const { validApply, SERVER_ONLY, aliveMs } = await import('@/lib/crm/ai-queue')
  it('הכפתורים דלוקים לפי קצב השגרה: פי 2 + 10 דק׳, לפחות 30', () => {
    expect(aliveMs(10)).toBe(30 * 60e3)
    expect(aliveMs(60)).toBe(130 * 60e3)
    expect(aliveMs(0)).toBe(30 * 60e3)
  })
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

describe('הרשאות לפי אזור (דן, 15/10)', () => {
  const sess = (r: CrmSession['r'], k = 'x'): CrmSession => ({ k, r, d: ['finance'], l: k, e: Date.now() + 1e6 })
  it('ברירת מחדל: כספים / לוח בקרה / הנה״ח — דן בלבד', () => {
    for (const r of ['admin', 'admin_re', 'partner', 'center'] as const) for (const k of DAN_GRANT) expect(permsOf({}, r)).not.toContain(k)
    expect(permsOf(null, 'owner')).toEqual([...AREAS, 'private'])
    expect(permsOf({}, 'center')).toEqual(['day', 'leads', 'tasks'])
  })
  it('וי במטריצה פותח / סוגר אזור; "היום שלי" תמיד פתוח, פרייבט אף פעם', () => {
    const u = { perms: { marketing: false, money: true, day: false, private: true } as Record<string, boolean> }
    const p = permsOf(u, 'admin')
    expect(p).toContain('money'); expect(p).not.toContain('marketing'); expect(p).toContain('day'); expect(p).not.toContain('private')
  })
  it('השרת לא מוסר אוספי כספים / שיווק בלי האזור, וסנכרון הבנק רק לדן', () => {
    const st = { users: [{ username: 'hadas', resp: 'hadas', role: 'admin' }, { username: 'h2', resp: 'h2', role: 'admin', perms: { money: true } }] }
    const s1 = sess('admin', 'hadas'), s2 = sess('admin', 'h2')
    expect(canRead(s1, 'expenses', sessionPerms(s1, st))).toBe(false)
    expect(canRead(s2, 'expenses', sessionPerms(s2, st))).toBe(true)
    expect(canWrite(s1, 'planned', sessionPerms(s1, st))).toBe(false)
    expect(canRead(s1, 'transactions', sessionPerms(s1, st))).toBe(true)
    expect(canRead(s2, 'stmts', sessionPerms(s2, st))).toBe(false)
    expect(canRead(sess('owner', 'dan'), 'stmts', sessionPerms(sess('owner', 'dan'), null))).toBe(true)
    expect(canRead(s1, 'campaigns', sessionPerms(s1, { users: [{ username: 'hadas', resp: 'hadas', role: 'admin', perms: { marketing: false } }] }))).toBe(false)
  })
  it('מי שאינו דן לא יכול לפתוח כספים דרך כתיבת ההגדרות', () => {
    const stored = { users: [{ username: 'nissim', resp: 'nissim', role: 'partner', perms: { money: false } }] }
    const inc = { users: [{ username: 'nissim', resp: 'nissim', role: 'partner', perms: { money: true, home: true, marketing: false } }] }
    const out = guardPerms(inc, stored, sess('admin', 'hadas')) as { users: { perms: Record<string, boolean> }[] }
    expect(out.users[0]!.perms).toEqual({ money: false, marketing: false })
    expect(guardPerms(inc, stored, sess('owner', 'dan'))).toBe(inc)
  })
  it('אותה טבלה בדף ובשרת', () => {
    const html = readFileSync('crm/harel-crm.html', 'utf8')
    const a = html.indexOf('const AREAS = ['), b = html.indexOf('const userKey = (u)', a)
    const code = html.slice(a, b)
    const page = new Function(code + '; return { AREAS, DAN_GRANT, permsOf };')() as { AREAS: [string, string][]; DAN_GRANT: string[]; permsOf: (u: unknown, r: string) => string[] }
    expect(page.AREAS.map((x) => x[0])).toEqual(AREAS)
    expect(page.DAN_GRANT).toEqual(DAN_GRANT)
    const cases: [Record<string, unknown> | null, CrmSession['r'] | 'team'][] = [[null, 'owner'], [{}, 'admin'], [{}, 'admin_re'], [{}, 'partner'], [{}, 'center'], [{}, 'team'], [{ perms: { money: true, leads: false } }, 'center']]
    for (const [u, r] of cases) expect(page.permsOf(u, r)).toEqual(permsOf(u, r))
  })
})

describe('כל עובד בשמו (S.me) — לא דן', () => {
  const e = Date.now() + 60e3
  const dan: CrmSession = { k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e }
  const eden: CrmSession = { k: 'eden', r: 'center', d: ['finance'], l: 'עדן', e }

  it('רק דן (סיסמת הנעילה) הוא הבעלים', () => {
    expect(isOwnerSession(dan)).toBe(true)
    expect(isOwnerSession(eden)).toBe(false)
    expect(isOwnerSession({ ...eden, r: 'owner' })).toBe(false) // עובד עם תפקיד בעלים — עדיין לא דן
  })

  it('חבר צוות קיים (מ-Claude) — אותו מזהה, כדי שההיסטוריה שלו תישאר שלו', () => {
    expect(pickMember([{ docId: 'abc', userId: 'claude-user-1', label: 'עדן ישן' }], eden)).toEqual({ id: 'claude-user-1', name: 'עדן' })
    expect(pickMember([{ docId: 'abc' }], eden)).toEqual({ id: 'abc', name: 'עדן' })
  })

  it('כמה רשומות — מעדיף את זו שמקושרת למשתמש', () => {
    expect(pickMember([{ docId: 'x' }, { docId: 'y', userId: 'uid-y' }], eden).id).toBe('uid-y')
  })

  it('אין חבר צוות — מזהה יציב לפי שם המשתמש, לא של דן', () => {
    expect(pickMember([], eden)).toEqual({ id: 'u-eden', name: 'עדן' })
    expect(memberId(' Eden Cohen ')).toBe('u-eden_cohen')
    expect(memberId('a/b')).toBe('u-a_b') // בלי / — נתיב מסמך חוקי
  })
})
