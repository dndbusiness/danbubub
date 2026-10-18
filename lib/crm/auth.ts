/**
 * כניסה אישית ל-CRM בשרת. שער המשרד (APP_PASSWORD, middleware.ts) נשאר מעל הכל; כאן — מי בדיוק נכנס.
 *
 * בדף ב-Claude מסך הנעילה בודק את הסיסמה בדפדפן, וכל מי ששותף בעריכה טוען את כל הנתונים.
 * בשרת זה לא מספיק: מי שעבר את שער המשרד יכול לקרוא את ה-API ישירות. לכן:
 *   · הסיסמה נבדקת כאן, מול אותם גיבובים (PBKDF2-SHA256 עם מלח, כמו בדף) — לא בדפדפן;
 *   · העוגייה חתומה (HMAC) ואומרת מי ומה התפקיד;
 *   · /api/crm/sync ו-/api/crm/write מסננים לפי התפקיד (ראו canRead / canWrite);
 *   · הגיבובים לא יוצאים לדפדפן (sanitizeSettings) ולא נדרסים בכתיבה ממנו (restoreSecrets).
 */
import { createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { sql } from '@/lib/db'
import { envSecret, secretEq } from '@/lib/secret'
import { githubOidc } from '@/lib/gh-oidc'
import type { CrmDoc } from '@/lib/crm/docs.js'
import { SERVER_ONLY, SERVER_WRITE } from '@/lib/crm/ai-queue'

export const USER_COOKIE = 'harel_crm_user'
export const SESSION_DAYS = 14
export type CrmRole = 'owner' | 'admin' | 'admin_re' | 'partner' | 'center'
export interface CrmSession { k: string; r: CrmRole; d: string[]; l: string; e: number }

/** אוספים שהמוקד לא קורא ולא כותב — כמו OWNER_READ בדף */
export const OWNER_READ = ['stmts', 'transactions', 'planned', 'expenses', 'campaigns', 'runs', 'private', 'payroll', 'reTx', 'reExpenses', 'rePlanned', 'kaveretPool', 'leadBills']
/** מה המוקד כן כותב — כמו TEAM_WRITE בדף */
export const TEAM_WRITE = ['tasks', 'files', 'days', 'tickets', 'outbox', 'team', 'leads', 'intakes', 'approvals', 'attendance', 'valuations']
/** סימן במקום גיבוב שלא נשלח לדפדפן */
export const SECRET_MARK = 'srv'

const DIVS = ['finance', 'realestate']
const normUser = (u: unknown) => String(u ?? '').trim().toLowerCase()

function secret(): string {
  const s = process.env.SECRETS_KEY || process.env.APP_PASSWORD
  if (!s) throw Object.assign(new Error('חסר SECRETS_KEY'), { code: 'failed_precondition' })
  return 'harel-crm-user-v1:' + s
}
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

export function encodeSession(s: CrmSession): string {
  const p = Buffer.from(JSON.stringify(s)).toString('base64url')
  return p + '.' + sign(p)
}

export function decodeSession(token: string | undefined | null, now = Date.now()): CrmSession | null {
  const [p, sig] = String(token ?? '').split('.')
  if (!p || !sig) return null
  const want = Buffer.from(sign(p)), got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const s = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as CrmSession
    return s && typeof s.k === 'string' && s.e > now ? s : null
  } catch { return null }
}

export function sessionOf(req: Request): CrmSession | null {
  const raw = req.headers.get('cookie') ?? ''
  const m = raw.split(/;\s*/).find((c) => c.startsWith(USER_COOKIE + '='))
  return decodeSession(m ? decodeURIComponent(m.slice(USER_COOKIE.length + 1)) : null)
}

export function sessionCookie(s: CrmSession | null, secure: boolean): string {
  const base = `${USER_COOKIE}=${s ? encodeURIComponent(encodeSession(s)) : ''}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  return s ? `${base}; Max-Age=${SESSION_DAYS * 86400}` : `${base}; Max-Age=0`
}

/** אותו חישוב כמו pwHash בדף: PBKDF2-SHA256, מלח hex, 32 בתים */
export function pwHash(pw: string, saltHex: string, iter: number): string {
  return pbkdf2Sync(pw, Buffer.from(saltHex, 'hex'), iter, 32, 'sha256').toString('hex')
}
function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

interface UserRec { username?: string; resp?: string; role?: string; divs?: string[]; label?: string; hash?: string; salt?: string; iter?: number; perms?: Record<string, boolean> }
export interface Settings { users?: UserRec[]; lock?: { hash?: string; salt?: string; iter?: number } }

/** כמו userRole / userDivs / userKey בדף */
export function roleOf(u: UserRec): CrmRole {
  if (u.role && ['owner', 'admin', 'admin_re', 'partner', 'center'].includes(u.role)) return u.role as CrmRole
  return u.resp === 'nissim' ? 'partner' : u.resp === 'hadas' ? 'admin' : 'center'
}
export function divsOf(u: UserRec, role = roleOf(u)): string[] {
  if (role === 'owner' || role === 'admin') return DIVS
  if (role === 'admin_re') return ['realestate']
  if (role === 'partner') return ['finance']
  const d = (u.divs ?? []).filter((x) => DIVS.includes(x))
  return d.length ? d : ['finance']
}

/**
 * הרשאות לפי אזור (דן, 15/10) — אותה טבלה כמו permsOf בדף (crm/harel-crm.html). וי לכל משתמש בכל אזור.
 * כספים / לוח בקרה / הנהלת חשבונות — רק דן נותן; ברירת מחדל: דן בלבד. פרייבט וסנכרון הבנק (stmts) — דן בלבד, תמיד.
 */
export const AREAS = ['day', 'leads', 'export', 'tasks', 'clients', 'service', 'lenders', 'marketing', 'reports', 'settings', 'home', 'money', 'books']
export const DAN_GRANT = ['home', 'money', 'books']
const CORE = ['day', 'leads', 'tasks', 'clients', 'service', 'lenders', 'marketing', 'reports']
const ROLE_AREAS: Record<string, string[]> = { admin: ['day', 'leads', 'export', ...CORE.slice(2), 'settings'], admin_re: ['day', 'leads', 'export', ...CORE.slice(2), 'settings'], partner: CORE, center: ['day', 'leads', 'tasks'], team: ['day', 'leads', 'tasks', 'clients', 'service'] }
/** אוספים שאזור פותח: מי שאין לו את האזור לא מקבל אותם מהשרת ולא כותב אליהם */
export const AREA_COLLS: Record<string, string[]> = { money: ['planned', 'expenses', 'payroll', 'reExpenses', 'rePlanned', 'leadBills'], marketing: ['campaigns', 'kaveretPool'] }

export function permsOf(u: UserRec | null | undefined, role: CrmRole | 'team'): string[] {
  if (role === 'owner') return [...AREAS, 'private']
  const set = new Set(ROLE_AREAS[role] ?? ROLE_AREAS.team), p = u?.perms ?? {}
  for (const k of AREAS) if (k in p) { if (p[k]) set.add(k); else set.delete(k) }
  set.add('day')
  return AREAS.filter((k) => set.has(k))
}
const userKeyOf = (u: UserRec) => u.resp || normUser(u.username)
/** ההרשאות של מי שנכנס — לפי רשומת המשתמש שלו בהגדרות (משתנה בלי כניסה מחדש) */
export function sessionPerms(s: CrmSession | null, settings: Settings | null): string[] {
  if (!s) return []
  if (s.r === 'owner') return [...AREAS, 'private']
  return permsOf((settings?.users ?? []).find((u) => userKeyOf(u) === s.k), s.r)
}
/**
 * כתיבת ההגדרות ממי שאינו דן: את הווי של כספים / לוח בקרה / הנה״ח אי אפשר לשנות — חוזרים לערך השמור.
 * (בלי זה מנהל מערכת היה פותח לעצמו את הכספים בקריאה ישירה ל-API.)
 */
export function guardPerms(incoming: Record<string, unknown>, stored: Settings | null, s: CrmSession): Record<string, unknown> {
  if (s.r === 'owner' || !Array.isArray(incoming.users)) return incoming
  const old = new Map((stored?.users ?? []).map((u) => [normUser(u.username), u]))
  return { ...incoming, users: (incoming.users as UserRec[]).map((u) => {
    const prev = old.get(normUser(u.username))?.perms ?? {}, perms: Record<string, boolean> = { ...(u.perms ?? {}) }
    for (const k of DAN_GRANT) { if (k in prev) perms[k] = !!prev[k]; else delete perms[k] }
    return { ...u, perms }
  }) }
}

/** בדיקת סיסמה מול ההגדרות. בלי שם משתמש = דן (סיסמת הנעילה). מחזיר סשן או null. */
export function verifyLogin(settings: Settings, username: string, password: string, now = Date.now()): CrmSession | null {
  const e = now + SESSION_DAYS * 86400e3
  if (!password) return null
  if (!normUser(username)) {
    const lk = settings.lock
    if (!lk?.hash || !lk.salt) return null
    return sameHex(pwHash(password, lk.salt, lk.iter || 210000), lk.hash) ? { k: 'dan', r: 'owner', d: DIVS, l: 'דן', e } : null
  }
  const u = (settings.users ?? []).find((x) => normUser(x.username) === normUser(username))
  if (!u?.hash || !u.salt) return null
  if (!sameHex(pwHash(password, u.salt, u.iter || 210000), u.hash)) return null
  const r = roleOf(u)
  return { k: u.resp || normUser(u.username), r, d: divsOf(u, r), l: u.label || u.username || '', e }
}

/** דן — נכנס בסיסמת הנעילה בלבד (בלי שם משתמש) */
export const isOwnerSession = (s: CrmSession) => s.k === 'dan' && s.r === 'owner'

/** מזהה חבר צוות לעובד שעוד אין לו (בדף ב-Claude זה היה מזהה החשבון שלו ב-Claude) */
export const memberId = (key: string) => 'u-' + String(key).trim().toLowerCase().replace(/[\/\s]+/g, '_').slice(0, 100)

/**
 * מי העובד בדף (S.me): חבר הצוות שלו אם קיים — אותו מזהה שכבר מופיע על משימות, לידים ויומנים מ-Claude;
 * אחרת מזהה יציב לפי שם המשתמש. השם = מה שבהגדרות המשתמשים, כדי ש"נוצר על ידי" יראה את השם שלו.
 */
export function pickMember(rows: { docId: string; userId?: string; label?: string; name?: string }[], s: CrmSession): { id: string; name: string } {
  const t = [...rows].sort((a, b) => Number(!!b.userId) - Number(!!a.userId))[0]
  return { id: t ? t.userId || t.docId : memberId(s.k), name: s.l || t?.label || t?.name || s.k }
}

/** אין סיסמת נעילה מוגדרת = הדף לא נועל, ומי שעבר את שער המשרד הוא הבעלים (כמו קודם) */
export const lockConfigured = (s: Settings) => !!(s.lock && s.lock.hash && s.lock.salt)

const areaBlocks = (coll: string, perms?: string[] | null) => !!perms && Object.entries(AREA_COLLS).some(([a, cs]) => cs.includes(coll) && !perms.includes(a))

/** perms = sessionPerms(...) — בלי perms נבדק רק התפקיד (כמו קודם) */
export function canRead(s: CrmSession | null, coll: string, perms?: string[] | null): boolean {
  if (coll === 'settings') return true
  if (SERVER_ONLY.includes(coll)) return false
  if (!s) return false
  if (coll === 'private' || coll === 'stmts') return s.r === 'owner'
  if (s.r === 'center') return !OWNER_READ.includes(coll)
  return !areaBlocks(coll, perms)
}

export function canWrite(s: CrmSession | null, coll: string, perms?: string[] | null): boolean {
  if (!s || SERVER_WRITE.includes(coll)) return false
  if (coll === 'private' || coll === 'stmts') return s.r === 'owner'
  if (s.r === 'center') return TEAM_WRITE.includes(coll)
  return !areaBlocks(coll, perms)
}

/** ההגדרות לדפדפן — בלי גיבובים ומלחים. הדף רואה רק שיש סיסמה. */
export function sanitizeSettings(data: CrmDoc): CrmDoc {
  const d = { ...(data as Record<string, unknown>) } as Record<string, unknown> & Settings
  if (Array.isArray(d.users)) d.users = d.users.map((u) => { const { hash, salt, iter, ...rest } = u; void salt; void iter; return hash ? { ...rest, hash: SECRET_MARK } : rest })
  if (d.lock && typeof d.lock === 'object') { const { hash, salt, iter, ...rest } = d.lock as Record<string, unknown>; void salt; void iter; d.lock = hash ? { ...rest, hash: SECRET_MARK } : rest }
  return d as CrmDoc
}

/**
 * כתיבה של settings/main מהדפדפן: משתמש שהגיבוב שלו לא שונה מגיע עם הסימן — מחזירים את הגיבוב השמור.
 * סיסמה חדשה מגיעה כגיבוב אמיתי עם מלח (הדף מחשב) ונשמרת כמו שהיא.
 */
export function restoreSecrets(incoming: Record<string, unknown>, stored: Settings | null): Record<string, unknown> {
  const out = { ...incoming }
  if (Array.isArray(out.users)) {
    const old = new Map((stored?.users ?? []).map((u) => [normUser(u.username), u]))
    out.users = (out.users as UserRec[]).map((u) => {
      const prev = old.get(normUser(u.username))
      if (u.hash && u.hash !== SECRET_MARK && u.salt) return u
      const { hash, ...rest } = u; void hash
      return prev?.hash ? { ...rest, hash: prev.hash, salt: prev.salt, iter: prev.iter } : rest
    })
  }
  if (out.lock && typeof out.lock === 'object') {
    const lk = out.lock as Record<string, unknown>
    if (lk.hash === SECRET_MARK || !lk.salt) out.lock = stored?.lock?.hash ? { ...lk, hash: stored.lock.hash, salt: stored.lock.salt, iter: stored.lock.iter } : (({ hash, ...r }) => { void hash; return r })(lk)
  }
  return out
}

export async function crmSettings(): Promise<Settings> {
  const [r] = await sql<{ data: Settings }[]>`select data from crm_docs where coll = 'settings' and doc_id = 'main' and deleted_at is null`
  return r?.data ?? {}
}

/** ניסיונות כושלים לכל כתובת — האטה (בזיכרון התהליך; מספיק כשכבה נוספת מעל שער המשרד) */
const fails = new Map<string, { n: number; at: number }>()
export function throttle(ip: string, ok?: boolean): number {
  const now = Date.now(), f = fails.get(ip)
  if (ok) { fails.delete(ip); return 0 }
  if (ok === false) { const n = f && now - f.at < 15 * 60e3 ? f.n + 1 : 1; fails.set(ip, { n, at: now }); return n }
  return f && now - f.at < 15 * 60e3 && f.n >= 5 ? Math.min(60, 2 ** (f.n - 4)) : 0
}

/**
 * מי מבקש: עוגיית הכניסה; או השומר (scripts/crm-keeper.mjs) עם JOBS_SECRET בכותרת או אסימון OIDC של GitHub; ואם עוד לא הוגדרה
 * סיסמת נעילה — מי שעבר את שער המשרד הוא הבעלים (כמו קודם, כדי שמערכת חדשה לא תינעל לפני שיש סיסמה).
 */
export async function effectiveSession(req: Request): Promise<CrmSession | null> {
  const s = sessionOf(req)
  if (s) return s
  const e = Date.now() + 60e3, owner: CrmSession = { k: 'dan', r: 'owner', d: DIVS, l: 'דן', e }
  if (secretEq(req.headers.get('x-crm-keeper'), envSecret('JOBS_SECRET'))) return owner
  if (req.headers.has('x-gh-oidc') && (await githubOidc(req)).ok) return owner /* השומר מ-GitHub Actions, בלי סוד */
  return lockConfigured(await crmSettings()) ? null : owner
}
