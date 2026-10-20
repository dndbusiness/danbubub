/**
 * ספריית ההסכמים (data/agreements/*.md) — הכללים הטהורים: קריאת קובץ, השדות, התאמה למוצר,
 * טעינה ל-settings.signLibrary בלי לדרוס עריכה או אישור של דן, ואישור נוסח.
 * בלי I/O ובלי new Date() — הקריאה מהדיסק ב-lib/sign/library.ts, הכתיבה בנתיב /api/sign/library.
 *
 * קובץ = front-matter (key, version, title, category, division, products, signers, requireOtp, source…)
 * + גוף בתחביר של הנוסח המוקלד (lib/rules/sign.ts renderAgreement): "# " כותרת · "- " סעיף · {{שדה}}.
 * {{שדה?}} = שדה רשות (בן/בת זוג) — ריק לא חוסם שליחה.
 */
import { SIGN_CATEGORIES, templateFields, type SignCategory } from './sign.js'

/** כל השדות שהנוסחים רשאים להשתמש בהם, עם התווית שמוצגת בטופס השליחה. חייב להיות זהה ל-SIGN_LABELS בדף. */
export const AGREEMENT_FIELDS: Record<string, string> = {
  company: 'שם החברה', date: 'תאריך', client_name: 'שם הלקוח', client_id: 'ת״ז הלקוח', client_address: 'כתובת', client_phone: 'טלפון', client_email: 'מייל',
  spouse_name: 'בן/בת זוג', spouse_id: 'ת״ז בן/בת זוג', service: 'השירות', amount: 'סכום הבקשה', fee: 'שכר טרחה',
  fee_percent: 'שכ״ט באחוזים', advance: 'מקדמה (₪ כולל מע״מ)', success_fee: 'שכר טרחת הצלחה', submit_days: 'ימי עסקים להגשת הבקשה',
  car_model: 'יצרן ודגם הרכב', car_plate: 'מספר רישוי', car_year: 'שנת ייצור', lien_holder: 'הגורם המשעבד', known_limits: 'הגבלות ידועות על הרכב',
  projects: 'הפרויקטים שהוצגו', payment_option: 'חלופת תשלום',
  /* דן, 20/10 — הסכם התוכנית העסקית ושטר החוב */
  pay_days: 'ימים לתשלום שכ״ט ההצלחה', card_type: 'סוג כרטיס האשראי', card_last4: '4 ספרות אחרונות בכרטיס', installments: 'מספר תשלומים',
  check_date: 'תאריך השיק / ההרשאה', check_amount: 'סכום השיק / ההרשאה',
  note_amount: 'סכום שטר החוב (₪)', note_amount_words: 'הסכום במילים', guarantor_name: 'ערב — שם', guarantor_id: 'ערב — ת״ז / ח.פ', guarantor_address: 'ערב — כתובת', guarantor_phone: 'ערב — טלפון',
}
/** שדות שהחותם עצמו ממלא בנוסח נפרד לכל חותם — לא נשאלים בטופס */
export const SIGNER_FIELDS = ['signer_name', 'signer_label']

export const DIVISIONS = ['finance', 'realestate'] as const
export type Division = (typeof DIVISIONS)[number]
export const SIGNER_MODES = ['client', 'client_spouse'] as const

/** סימון הטיוטה של ספריית ההסכמים — "[טיוטה" הוא מה שחוסם שליחה (isSignDraft) */
export const LIB_DRAFT = '[טיוטה — נוסח מספריית ההסכמים. לא נשלח ללקוח עד שדן מאשר בהגדרות ← "אשר נוסח"]'

export interface LibTemplate {
  key: string; version: number; order: number; title: string; category: SignCategory; division: Division
  products: string[]; signers: 'client' | 'client_spouse'; perSigner: boolean; requireOtp: boolean
  source: string; sourceId: string; note: string; body: string
  /** 'dan' = דן שלח את הנוסח בעצמו (קובץ) — נטען מאושר, בלי שלב "אשר נוסח" */
  providedBy?: string; attachment?: boolean
}

/** front-matter פשוט: key: value · רשימה [a, b] · true/false · מספר. */
export function parseFrontMatter(md: string): { meta: Record<string, string | string[] | boolean | number>; body: string } {
  const text = String(md ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string | string[] | boolean | number> = {}
  for (const line of m[1]!.split('\n')) {
    const kv = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line.trim())
    if (!kv) continue
    const raw = kv[2]!.trim()
    let v: string | string[] | boolean | number = raw.replace(/^"(.*)"$/, '$1')
    if (/^\[.*\]$/.test(raw)) v = raw.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
    else if (raw === 'true' || raw === 'false') v = raw === 'true'
    else if (/^\d+$/.test(raw)) v = Number(raw)
    meta[kv[1]!] = v
  }
  return { meta, body: m[2]!.replace(/^\n+/, '').replace(/\s+$/, '') + '\n' }
}

/** קובץ הסכם → תבנית. מחזיר שגיאות בעברית אם הקובץ לא תקין (key, גרסה, שדות לא מוכרים…). */
export function parseAgreement(md: string, fileName = ''): { ok: true; tpl: LibTemplate } | { ok: false; errors: string[] } {
  const { meta, body } = parseFrontMatter(md)
  const errors: string[] = []
  const str = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string) : '')
  const key = str('key'), title = str('title'), category = str('category'), division = str('division'), signers = str('signers') || 'client'
  const who = fileName || key || 'קובץ'
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(key)) errors.push(`${who}: key חסר או לא תקין`)
  if (fileName && key && fileName.replace(/\.md$/, '') !== key) errors.push(`${who}: שם הקובץ צריך להיות ${key}.md`)
  const version = typeof meta.version === 'number' ? meta.version : NaN
  if (!Number.isInteger(version) || version < 1) errors.push(`${who}: version חייב להיות מספר שלם ≥ 1`)
  if (title.length < 3) errors.push(`${who}: חסר title`)
  if (!(category in SIGN_CATEGORIES)) errors.push(`${who}: category לא מוכר (${category})`)
  if (!(DIVISIONS as readonly string[]).includes(division)) errors.push(`${who}: division חייב להיות finance או realestate`)
  if (!(SIGNER_MODES as readonly string[]).includes(signers)) errors.push(`${who}: signers חייב להיות client או client_spouse`)
  const products = Array.isArray(meta.products) ? meta.products : []
  if (body.trim().length < 200) errors.push(`${who}: הנוסח קצר מדי`)
  if (/\[\s*טיוטה/.test(body)) errors.push(`${who}: הסימון [טיוטה לא נכתב בקובץ — הוא מתווסף בטעינה`)
  const unknown = templateFields(body).filter((f) => !(f in AGREEMENT_FIELDS) && !SIGNER_FIELDS.includes(f))
  if (unknown.length) errors.push(`${who}: שדות שאין להם תווית: ${unknown.join(', ')}`)
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    tpl: {
      key, version, order: typeof meta.order === 'number' ? meta.order : 100, title, category: category as SignCategory, division: division as Division,
      products, signers: signers as LibTemplate['signers'], perSigner: meta.perSigner === true, requireOtp: meta.requireOtp === true,
      source: str('source'), sourceId: str('sourceId'), note: str('note'), body,
      ...(str('providedBy') ? { providedBy: str('providedBy') } : {}), ...(meta.attachment === true ? { attachment: true } : {}),
    },
  }
}

/** FNV-1a 32 ביט — טביעה קצרה לזיהוי "דן ערך את הנוסח" (לא אבטחה). */
export function textHash(s: string): string {
  let h = 0x811c9dc5
  const str = String(s ?? '').replace(/\r\n?/g, '\n').trim()
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

/** הנוסח בלי שורת הטיוטה של הספרייה (ושורה ריקה אחריה). */
export function stripLibDraft(body: string): string {
  const t = String(body ?? '').replace(/\r\n?/g, '\n')
  return t.startsWith(LIB_DRAFT) ? t.slice(LIB_DRAFT.length).replace(/^\n+/, '') : t
}

/** פריט ב-settings.signLibrary — מה שהדף כבר מכיר, ועוד שדות הספרייה. */
export interface LibItem {
  key: string; title: string; category: string; lender?: string; division?: string; signers?: string; perSigner?: boolean; requireOtp?: boolean; body: string
  products?: string[]; order?: number; source?: string; sourceId?: string; note?: string
  lib?: boolean; libKey?: string; libVersion?: number; libHash?: string; loadedAt?: string; loadedBy?: string
  approvedAt?: string | null; approvedBy?: string | null; approvedVersion?: number | null
  prevBody?: string; deletedAt?: string | null; updatedAt?: string; by?: string
  [k: string]: unknown
}

export const libItemKey = (libKey: string) => 'lib:' + libKey

function itemOf(t: LibTemplate, at: string, by: string): LibItem {
  if (t.providedBy === 'dan') return { ...draftItem(t, at, by), body: t.body, approvedAt: at, approvedBy: 'דן (שלח את הנוסח כקובץ)', approvedVersion: t.version, ...(t.attachment ? { attachment: true } : {}) }
  return draftItem(t, at, by)
}
function draftItem(t: LibTemplate, at: string, by: string): LibItem {
  return {
    key: libItemKey(t.key), title: t.title, category: t.category, lender: '', division: t.division, signers: t.signers, perSigner: t.perSigner, requireOtp: t.requireOtp,
    body: LIB_DRAFT + '\n\n' + t.body, products: t.products, order: t.order, source: t.source, sourceId: t.sourceId, note: t.note,
    lib: true, libKey: t.key, libVersion: t.version, libHash: textHash(t.body), loadedAt: at, loadedBy: by, approvedAt: null, approvedBy: null, approvedVersion: null,
    updatedAt: at, by,
  }
}

/** הפריט לא נגעו בו מאז הטעינה: לא נמחק, הנוסח זהה למה שנטען, ולא אושר — או שאושר בטעינה כי דן שלח אותו (approvedVersion = הגרסה שנטענה). */
export function isPristine(e: LibItem): boolean {
  const autoApproved = !!e.approvedAt && String(e.approvedBy ?? '').startsWith('דן (שלח') && e.approvedVersion === e.libVersion
  return !e.deletedAt && (!e.approvedAt || autoApproved) && !!e.libHash && textHash(stripLibDraft(e.body)) === e.libHash
}

export type LoadAction = 'added' | 'updated' | 'unchanged' | 'conflict' | 'overwritten'
export interface LoadReport { key: string; title: string; version: number; action: LoadAction; reason?: string }

/**
 * טעינת הספרייה ל-settings.signLibrary. idempotent: אותה גרסה = בלי שינוי (גם אם דן ערך/אישר).
 *   חדש → נוסף כטיוטה · גרסה חדשה ופריט שלא נגעו בו → מוחלף בטיוטה החדשה ·
 *   גרסה חדשה ופריט שדן ערך / אישר / מחק → "conflict" — נדרס רק אם המפתח ב-overwrite (הנוסח הקודם נשמר ב-prevBody).
 * תבניות שלא מהספרייה (נוצרו ידנית) — לא נוגעים.
 */
export function mergeLibrary(current: LibItem[], incoming: LibTemplate[], opts: { at: string; by: string; overwrite?: string[] }): { library: LibItem[]; report: LoadReport[] } {
  const over = new Set(opts.overwrite ?? [])
  const out = [...(current ?? [])]
  const report: LoadReport[] = []
  for (const t of [...incoming].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))) {
    const i = out.findIndex((x) => x.key === libItemKey(t.key))
    const fresh = itemOf(t, opts.at, opts.by)
    const r = { key: t.key, title: t.title, version: t.version }
    if (i < 0) { out.push(fresh); report.push({ ...r, action: 'added' }); continue }
    const e = out[i]!
    if (!e.deletedAt && (e.libVersion ?? 0) >= t.version) { report.push({ ...r, action: 'unchanged' }); continue }
    if (isPristine(e)) { out[i] = fresh; report.push({ ...r, action: 'updated' }); continue }
    const reason = e.deletedAt ? 'נמחקה' : e.approvedAt ? 'אושרה' : 'נערכה'
    if (over.has(t.key)) { out[i] = { ...fresh, prevBody: e.body }; report.push({ ...r, action: 'overwritten', reason }); continue }
    report.push({ ...r, action: 'conflict', reason: (e.deletedAt && (e.libVersion ?? 0) >= t.version ? reason : reason + ' — יש גרסה ' + t.version) })
  }
  return { library: out, report }
}

/** אישור נוסח: מוריד את סימון הטיוטה של הספרייה ורושם מי ומתי. סימון "[טיוטה" אחר בנוסח — נשאר וחוסם. */
export function approveItem(e: LibItem, by: string, at: string): LibItem {
  return { ...e, body: stripLibDraft(e.body), approvedAt: at, approvedBy: by, approvedVersion: e.libVersion ?? null, updatedAt: at, by }
}

/**
 * איזו תבנית להציע בכרטיס: לפי החברה והמוצר של הלקוח (הראשונה לפי order), אחרת — הסכם ההתקשרות של החברה.
 * תבניות שנמחקו לא מוצעות. מחזיר key.
 */
export function suggestTemplate(lib: Pick<LibItem, 'key' | 'division' | 'products' | 'order' | 'deletedAt'>[], c: { division?: string | null; product?: string | null }): string {
  const div = c.division || 'finance'
  const hit = lib.filter((t) => !t.deletedAt && (!t.division || t.division === div) && !!c.product && (t.products ?? []).includes(c.product))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))[0]
  return hit ? hit.key : 'agreement:' + div
}
