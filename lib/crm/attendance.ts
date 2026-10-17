/**
 * שעון נוכחות — הכללים הטהורים (בקשת דן, 17/10/26). בלי DB, בלי שעון: "עכשיו" תמיד ארגומנט.
 *
 *  · מחשב משרד רשום — הכניסה נספרת כמשרד בלי מיקום, וכל המשמרת "משרד" (in.device).
 *  · טלפון מחוץ לטווח המשרד, בלי אישור עבודה מהבית להיום → awayAt + התראה למנהל;
 *    לא אושר תוך 15 דקות (או נדחה) → יציאה אוטומטית בשעת היציאה מהטווח (out.auto) + ניתוק.
 *    חזר לטווח לפני כן → awayAt מתאפס, ונשארת הערה (aways).
 *  · שעה בלי פעילות (כל הצוות) → התראה אחת למנהל לכל פער; השעון ממשיך, והפער נרשם.
 *  · סוף היום (23:00 שעון ישראל) / יום קודם — משמרת פתוחה נסגרת בפעילות האחרונה.
 *
 * אותו קוד בדיוק יושב בדף (crm/harel-crm.html, בין "══ נוכחות — כללים טהורים" ל-"══ סוף כללי נוכחות"),
 * ו-tests/crm-attendance.test.ts מריץ את שניהם על אותם מקרים — כך הדף והג'וב attendance_watch
 * מייצרים את אותו rule_key, וההתראה לא נשלחת פעמיים (הנחיה 18).
 */

export const ATT = { awayGraceMin: 15, idleMin: 60, geoEveryMin: 5, dayEndHour: 23, lookbackDays: 3 } as const

export interface AttUser { username?: string; resp?: string; role?: string; divs?: string[]; label?: string; email?: string; phone?: string; manager?: string }
export interface AttSettings { users?: AttUser[]; notifyPhones?: Record<string, string>; notifyEmails?: Record<string, string>; teamEmails?: Record<string, string>; ownerEmail?: string }
export interface AttGap { from: string; to: string; min: number; open?: boolean }
export interface AttHome { status?: string; reason?: string; note?: string; at?: string; by?: string | null }
export interface AttOut { at: string; place?: string; auto?: boolean; reason?: string; note?: string; autoAt?: string }
export interface AttDoc {
  id?: string; key: string; label?: string; date: string
  in?: { at: string; place?: string; device?: string; dist?: number }
  out?: AttOut | null; lastActive?: string; gaps?: AttGap[]; home?: AttHome | null
  awayAt?: string | null; aways?: { from: string; back: string }[]; notified?: string[]; deletedAt?: string | null
}
export type AttKind = 'away' | 'idle'
export interface AttNotify { kind: AttKind; ruleKey: string; at: string; min?: number }
export interface AttStep { patch: Record<string, unknown> | null; notify: AttNotify[]; logout: boolean; why: string }

const DIVS = ['finance', 'realestate']
const attUKey = (u: AttUser) => u.resp || String(u.username ?? '').trim().toLowerCase()
/** כמו userRole / userDivs בדף */
function attURole(u: AttUser): string {
  return u.role && ['owner', 'admin', 'admin_re', 'partner', 'center'].includes(u.role) ? u.role : u.resp === 'nissim' ? 'partner' : u.resp === 'hadas' ? 'admin' : 'center'
}
function attUDivs(u: AttUser, role: string): string[] {
  if (role === 'owner' || role === 'admin') return DIVS
  if (role === 'admin_re') return ['realestate']
  if (role === 'partner') return ['finance']
  const d = (u.divs ?? []).filter((x) => DIVS.includes(x))
  return d.length ? d : ['finance']
}

/** תאריך, שעה ו-HH:MM בשעון ישראל — בדפדפן ובשרת אותו דבר */
export function attTz(ms: number): { date: string; hour: number; hm: string } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return { date: g('year') + '-' + g('month') + '-' + g('day'), hour: Number(g('hour')), hm: g('hour') + ':' + g('minute') }
}

/** rule_key אחד לכל אירוע: יציאה מהטווח (לפי שעת היציאה) / פער פעילות (לפי תחילת הפער) */
export const attRuleKey = (kind: AttKind, key: string, date: string, at: string) => 'att_' + kind + ':' + key + ':' + date + ':' + at

/**
 * מי המנהל שמקבל את ההתראה: users[].manager גובר; אחרת הדס ופתרונות → דן,
 * מוקד ונדל"ן (רק השקעות, או מנהל השקעות) → אביב. מוקד שרשום רק לפתרונות → דן. דן — אף אחד.
 */
export function attManagerOf(key: string | null | undefined, users: AttUser[] | null | undefined): string | null {
  if (!key || key === 'dan') return null
  const u = (users ?? []).find((x) => attUKey(x) === key)
  if (u && u.manager && u.manager !== key) return u.manager
  if (!u) return 'dan'
  const role = attURole(u), divs = attUDivs(u, role)
  const re = role === 'admin_re' || divs.every((d) => d === 'realestate') || (role === 'center' && divs.includes('realestate'))
  const m = re ? 'aviv' : 'dan'
  return m === key ? 'dan' : m
}

/** פער פעילות: אחד לכל תחילת פער (from). הג'וב רושם פער פתוח, והדף סוגר אותו כשהעובד חוזר */
export function attUpsertGap(gaps: AttGap[] | null | undefined, from: string, to: string, open = false): AttGap[] {
  const g = (gaps ?? []).filter((x) => x.from !== from)
  const min = Math.round((Date.parse(to) - Date.parse(from)) / 60000)
  return [...g, { from, to, min, ...(open ? { open: true } : {}) }].sort((x, y) => String(x.from).localeCompare(String(y.from)))
}

export const ATT_WHY: Record<string, string> = {
  away: 'יצא/ה מטווח המשרד ולא אושרה עבודה מהבית תוך 15 דקות',
  rejected: 'יצא/ה מטווח המשרד — המנהל לא אישר עבודה מהבית',
  eod: 'המשמרת נשארה פתוחה בסוף היום — נסגרה לפי הפעילות האחרונה',
}

/** יציאה אוטומטית: out.at = שעת היציאה מהטווח / הפעילות האחרונה, לא שעת ההחלטה */
export function attOutPatch(a: AttDoc, at: string, why: string, nowIso: string): Record<string, unknown> {
  const t = a.in && Date.parse(at) < Date.parse(a.in.at) ? a.in.at : at
  const home = a.home ?? null
  return {
    out: { at: t, place: why === 'eod' ? (a.in?.place || 'unknown') : 'away', auto: true, reason: why, note: ATT_WHY[why] ?? '', autoAt: nowIso },
    ...(why !== 'eod' && home && home.status === 'pending' ? { home: { ...home, status: 'expired', at: nowIso } } : {}),
  }
}

/**
 * צעד אחד של השעון. c.inRange: true / false = הטלפון בדק מיקום עכשיו; null / undefined = אין בדיקה
 * (מחשב משרד, אין מיקום, או השרת — שלא רואה מיקום). c.activeAt = פעילות אחרונה בדפדפן שעוד לא נכתבה.
 */
export function attStep(a: AttDoc | null | undefined, c: { now: number; inRange?: boolean | null; activeAt?: number }): AttStep {
  const r: AttStep = { patch: null, notify: [], logout: false, why: '' }
  if (!a || !a.in || !a.in.at || a.out || a.deletedAt) return r
  const now = c.now, nowIso = new Date(now).toISOString(), z = attTz(now), last = a.lastActive || a.in.at
  if (a.date < z.date || (a.date === z.date && z.hour >= ATT.dayEndHour)) return { patch: attOutPatch(a, last, 'eod', nowIso), notify: [], logout: false, why: 'eod' }
  const home = a.home ?? {}, P: Record<string, unknown> = {}
  if (!a.in.device && home.status !== 'approved') {
    if (a.awayAt) {
      if (c.inRange === true) {
        P.awayAt = null; P.aways = [...(a.aways ?? []), { from: a.awayAt, back: nowIso }]
        if (home.reason === 'away' && home.status === 'pending') P.home = { ...home, status: 'back', at: nowIso }
      } else if (home.status === 'rejected' || now - Date.parse(a.awayAt) >= ATT.awayGraceMin * 60e3) {
        const why = home.status === 'rejected' ? 'rejected' : 'away'
        return { patch: attOutPatch(a, a.awayAt, why, nowIso), notify: [], logout: true, why }
      } else {
        const k = attRuleKey('away', a.key, a.date, a.awayAt)
        if (!(a.notified ?? []).includes(k)) r.notify.push({ kind: 'away', ruleKey: k, at: a.awayAt })
      }
    } else if (c.inRange === false) {
      P.awayAt = nowIso; P.home = { ...home, status: 'pending', reason: 'away', at: nowIso }
      r.notify.push({ kind: 'away', ruleKey: attRuleKey('away', a.key, a.date, nowIso), at: nowIso })
    }
  }
  const act = Math.max(Date.parse(last), c.activeAt || 0)
  if ((now - act) / 60000 >= ATT.idleMin) {
    const k = attRuleKey('idle', a.key, a.date, last)
    if (!(a.notified ?? []).includes(k)) {
      r.notify.push({ kind: 'idle', ruleKey: k, at: last, min: Math.floor((now - Date.parse(last)) / 60000) })
      P.gaps = attUpsertGap(a.gaps, last, nowIso, true)
    }
  }
  if (Object.keys(P).length) r.patch = P
  r.why = r.notify.map((x) => x.kind).join(',')
  return r
}

/** נוסח ההתראה — אותו נוסח בוואטסאפ, במייל ובמערכת */
export function attAlertText(kind: AttKind, label: string, at: string, min?: number): string {
  const t = attTz(Date.parse(at)).hm
  return kind === 'away' ? label + ' יצא/ה מטווח המשרד ב-' + t + ' — לאשר עבודה מהבית?' : label + ' בלי פעילות במערכת ' + (min ?? ATT.idleMin) + ' דקות (מאז ' + t + ') — השעון ממשיך לרוץ'
}
/* ══ סוף החלק המשותף לדף ══ */

/** 050-1234567 → 972501234567 (Green-API). לא מספר → '' */
export function attPhone(p: unknown): string {
  let d = String(p ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = '972' + d.slice(1)
  return d.length >= 11 && d.length <= 15 ? d : ''
}

/** טלפון ומייל של המנהל: settings.notifyPhones / notifyEmails גוברים, אחרת רשומת המשתמש / teamEmails / ownerEmail */
export function attContacts(mgr: string, s: AttSettings): { whatsapp: string | null; email: string | null } {
  const u = (s.users ?? []).find((x) => attUKey(x) === mgr) ?? {}
  const email = String((s.notifyEmails ?? {})[mgr] || u.email || (s.teamEmails ?? {})[mgr] || (mgr === 'dan' ? s.ownerEmail : '') || '').trim()
  return { whatsapp: attPhone((s.notifyPhones ?? {})[mgr] || u.phone) || null, email: /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(email) ? email : null }
}

const escHtml = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

export interface AttOutboxRow { channel: 'whatsapp' | 'email'; target: string; subject: string | null; body: string; dedupKey: string }

/** שורות ה-outbox להתראה (הנחיה 16). dedup_key = rule_key + ערוץ — אותה התראה לא נכנסת פעמיים */
export function attOutboxRows(n: AttNotify, a: AttDoc, s: AttSettings, baseUrl = ''): { manager: string | null; rows: AttOutboxRow[] } {
  const mgr = attManagerOf(a.key, s.users)
  if (!mgr) return { manager: null, rows: [] }
  const c = attContacts(mgr, s), label = a.label || a.key, txt = attAlertText(n.kind, label, n.at, n.min)
  const link = baseUrl ? baseUrl.replace(/\/$/, '') + '/crm#day' : ''
  const extra = n.kind === 'away' ? 'אם לא יאושר תוך ' + ATT.awayGraceMin + ' דקות — יציאה אוטומטית מהמשמרת. מאשרים במערכת: היום שלי ← הצוות עכשיו.' : ''
  const rows: AttOutboxRow[] = []
  if (c.whatsapp) rows.push({ channel: 'whatsapp', target: c.whatsapp, subject: null, body: [txt, extra, link].filter(Boolean).join('\n'), dedupKey: n.ruleKey + ':whatsapp' })
  if (c.email) rows.push({ channel: 'email', target: c.email, subject: 'הר-אל · נוכחות · ' + label, dedupKey: n.ruleKey + ':email',
    body: '<div dir="rtl" style="font-family:Arial,sans-serif"><p><b>' + escHtml(txt) + '</b></p>' + (extra ? '<p>' + escHtml(extra) + '</p>' : '') + (link ? '<p><a href="' + escHtml(link) + '">פתיחת המערכת</a></p>' : '') + '</div>' })
  return { manager: mgr, rows }
}

/** ההתראה שהדף מבקש לשלוח — רק אם המצב במסמך באמת מצדיק אותה (לא סומכים על הדפדפן) */
export function attNotifyCheck(a: AttDoc | null | undefined, kind: AttKind, now: number): AttNotify | null {
  if (!a || !a.in || a.out || a.deletedAt) return null
  if (kind === 'away') {
    if (!a.awayAt || a.in.device || a.home?.status === 'approved') return null
    return { kind, ruleKey: attRuleKey('away', a.key, a.date, a.awayAt), at: a.awayAt }
  }
  const last = a.lastActive || a.in.at, min = Math.floor((now - Date.parse(last)) / 60000)
  return min >= ATT.idleMin ? { kind, ruleKey: attRuleKey('idle', a.key, a.date, last), at: last, min } : null
}

export interface AttWatchItem { id: string; patch: Record<string, unknown> | null; notify: AttNotify[]; rows: AttOutboxRow[]; why: string }

/**
 * הג'וב attendance_watch: לכל משמרת פתוחה — מה לכתוב ומה לשלוח. השרת לא רואה מיקום (inRange חסר),
 * ולכן רק: יציאה שלא אושרה תוך 15 דקות, שעה בלי פעילות, וסגירה בסוף היום.
 * rule_key שנשלח נרשם ב-notified, כדי שלא יישלח שוב (גם ה-dedup_key ב-outbox מגן).
 */
export function attWatchPlan(docs: { id: string; data: AttDoc }[], s: AttSettings, now: number, baseUrl = ''): AttWatchItem[] {
  const out: AttWatchItem[] = []
  for (const { id, data } of docs) {
    const st = attStep(data, { now })
    if (!st.patch && !st.notify.length) continue
    const rows = st.notify.flatMap((n) => attOutboxRows(n, data, s, baseUrl).rows)
    const patch: Record<string, unknown> = { ...(st.patch ?? {}) }
    if (st.notify.length) patch.notified = [...(data.notified ?? []), ...st.notify.map((n) => n.ruleKey)]
    out.push({ id, patch, notify: st.notify, rows, why: st.why })
  }
  return out
}
