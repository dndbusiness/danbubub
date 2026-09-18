/**
 * ייבוא מ-WISE — SPEC §4.5.
 *
 * "WISE נשארת מקור האמת התפעולי ללידים, לקוחות והגשות לבנקים. המערכת שלנו היא
 *  מקור האמת לכסף. אין הזנה כפולה — מייבאים ומחברים."
 *
 * שלושה ייצואים, שלושה יעדים: מתעניינים → `leads` · לקוחות → `deals` ·
 * סטטוס בקשות → `deal_submissions`. הקובץ הזה טהור: מפענח, ממפה ומזהה ערוץ.
 * הכתיבה ל-DB (כולל ה-idempotency) יושבת ב-`lib/import/wise-load.ts`.
 */
import type { Cell } from './workbook.js'
import { toIsoDate } from './workbook.js'

export type WiseExportKind = 'leads' | 'customers' | 'submissions'

const norm = (s: unknown) => String(s ?? '').replace(/^﻿/, '').replace(/[׳״'"]+/g, '').replace(/\s+/g, ' ').trim()

const COLUMNS = {
  name: ['שם מלא', 'שם הלקוח', 'שם הלקוח', 'שם'],
  phone: ['טלפון נייד', 'נייד', 'טלפון'],
  email: ['אימייל', 'דואר אלקטרוני', 'מייל'],
  source: ['מקור הפניה', 'מקור פניה', 'מקור'],
  created: ['תאריך הקמה', 'תאריך יצירה', 'תאריך'],
  status: ['סטטוס מעקב', 'סטטוס'],
  activity: ['פעילות אחרונה', 'הערות'],
  nationalId: ['תז', 'ת ז', 'מספר זהות'],
  bank: ['בנק'],
  branch: ['סניף'],
  submitted: ['תאריך הגשה'],
  approved: ['תאריך אישור'],
  amount: ['סכום הלוואה', 'סכום', 'סכום העסקה'],
} as const

function col(headers: string[], candidates: readonly string[]): number {
  for (const c of candidates) { const i = headers.findIndex((h) => h === norm(c)); if (i >= 0) return i }
  for (const c of candidates) { const i = headers.findIndex((h) => h.includes(norm(c))); if (i >= 0) return i }
  return -1
}

/** מזהה איזה משלושת הייצואים זה, לפי הכותרות. */
export function detectWiseExport(rows: Cell[][]): { kind: WiseExportKind; index: number; headers: string[] } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const headers = (rows[i] ?? []).map(norm)
    if (!headers.some(Boolean)) continue
    const has = (c: readonly string[]) => col(headers, c) >= 0
    if (has(COLUMNS.bank) && (has(COLUMNS.submitted) || has(COLUMNS.approved))) return { kind: 'submissions', index: i, headers }
    if (has(COLUMNS.status) && has(COLUMNS.source)) return { kind: 'leads', index: i, headers }
    if (has(COLUMNS.name) && (has(COLUMNS.nationalId) || has(COLUMNS.amount))) return { kind: 'customers', index: i, headers }
  }
  return null
}

// ── §4.5 — מיפוי סטטוס WISE לרמות המשפך שלנו ───────────────────────────────

/** ערכי ה-enum ב-DB (`lead_stage`) — לא שמות חופשיים. */
export type LeadStage = 'received' | 'contacted' | 'meeting' | 'proposal' | 'signed' | 'closed_won' | 'closed_lost'

const STAGE_MAP: { match: string; stage: LeadStage }[] = [
  { match: 'ליד חדש', stage: 'received' },
  { match: 'חדשים לא נענו', stage: 'received' },
  { match: 'אין מענה', stage: 'contacted' },
  { match: 'לחשוב על זה', stage: 'contacted' },
  { match: 'נשלחו דוחות', stage: 'contacted' },
  { match: 'נסגר וחתם', stage: 'signed' },
  { match: 'לקוח נסגר ועבר ללקוחות', stage: 'signed' },
  { match: 'לא רלוונטי', stage: 'closed_lost' },
  { match: 'קמפיינים ישנים', stage: 'closed_lost' },
]

/** §4.5 — הסטטוס ב-WISE הוא טקסט חופשי-למחצה; כל מה שלא מוכר נשאר `received` ומסומן. */
export function mapWiseStage(status: string): { stage: LeadStage; known: boolean } {
  const n = norm(status)
  for (const { match, stage } of STAGE_MAP) if (n.includes(norm(match))) return { stage, known: true }
  return { stage: 'received', known: false }
}

// ── §4.5 — זיהוי ערוץ אוטומטי ───────────────────────────────────────────────

/** `car-05XXXXXXXX@car.com` → לנדינג הרכב. הטלפון עצמו מוטמע באימייל. */
export const CAR_LANDING_EMAIL = /^car-(0\d{8,9})@car\.com$/i

export interface ChannelGuess {
  source: string
  product: string
  /** האם זוהה לפי כלל ודאי (אימייל הרכב) או לפי ברירת מחדל. */
  certain: boolean
}

export function detectChannel(email: string | null, sourceText: string, defaults: { formProduct?: string } = {}): ChannelGuess {
  if (email && CAR_LANDING_EMAIL.test(email.trim())) {
    return { source: 'רכב-לנדינג', product: 'vehicle_lien', certain: true }
  }
  const s = norm(sourceText)
  if (s.includes('הוכנס ידנית')) return { source: 'הוכנס ידנית', product: defaults.formProduct ?? 'mortgage', certain: false }
  if (s.includes('טופס')) return { source: 'טופס – אתר אינטרנט', product: defaults.formProduct ?? 'mortgage', certain: false }
  return { source: s || 'לא ידוע', product: defaults.formProduct ?? 'mortgage', certain: false }
}

/** טלפון ישראלי מנורמל — מפתח השידוך של §4.5. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('972')) return `0${digits.slice(3)}`
  if (digits.length === 9 && digits.startsWith('5')) return `0${digits}`
  return digits
}

// ── הפענוח ──────────────────────────────────────────────────────────────────

export interface WiseLead {
  wiseRef: string
  name: string | null
  phone: string | null
  email: string | null
  date: string
  sourceName: string
  product: string
  channelCertain: boolean
  stage: LeadStage
  statusRaw: string
  statusKnown: boolean
  notes: string | null
  rowIndex: number
}

export interface WiseCustomer {
  wiseRef: string
  name: string
  phone: string | null
  email: string | null
  nationalId: string | null
  date: string | null
  amount: number | null
  rowIndex: number
}

export interface WiseSubmission {
  wiseRef: string
  clientName: string
  bank: string
  branch: string | null
  submittedAt: string | null
  approvedAt: string | null
  status: string | null
  rowIndex: number
}

export interface WiseParseResult {
  kind: WiseExportKind
  leads: WiseLead[]
  customers: WiseCustomer[]
  submissions: WiseSubmission[]
  warnings: string[]
  skipped: number
  /** סטטוסים שלא מופו — כדי שנדע להוסיף אותם ולא נשתוק. */
  unknownStatuses: string[]
}

export interface ParseWiseOptions {
  defaultYear?: number
  formProduct?: string
}

export function parseWiseExport(rows: Cell[][], opts: ParseWiseOptions = {}): WiseParseResult | { error: string } {
  const found = detectWiseExport(rows)
  if (!found) return { error: 'לא זוהה ייצוא של WISE: חסרות העמודות המזהות (סטטוס מעקב / בנק / שם).' }
  const { kind, index, headers } = found
  const ix = Object.fromEntries(Object.entries(COLUMNS).map(([k, v]) => [k, col(headers, v)])) as Record<keyof typeof COLUMNS, number>
  const year = opts.defaultYear ?? new Date().getUTCFullYear()

  const leads: WiseLead[] = []
  const customers: WiseCustomer[] = []
  const submissions: WiseSubmission[] = []
  const warnings: string[] = []
  const unknown = new Set<string>()
  let skipped = 0

  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const isEmpty = !r.some((c) => c !== null && c !== undefined && String(c).trim() !== '')
    if (isEmpty) continue

    const name = ix.name >= 0 ? norm(r[ix.name]) : ''
    const phone = normalizePhone(ix.phone >= 0 ? String(r[ix.phone] ?? '') : '')
    const email = ix.email >= 0 ? norm(r[ix.email]).toLowerCase() || null : null

    if (kind === 'leads') {
      // §4.5 — מפתח השידוך הוא טלפון נייד (+ אימייל). בלי אחד מהם אין איך לשדך.
      if (!phone && !email) { skipped++; continue }
      const statusRaw = ix.status >= 0 ? norm(r[ix.status]) : ''
      const { stage, known } = mapWiseStage(statusRaw)
      if (!known && statusRaw) unknown.add(statusRaw)
      const channel = detectChannel(email, ix.source >= 0 ? norm(r[ix.source]) : '', { formProduct: opts.formProduct })
      const date = (ix.created >= 0 ? toIsoDate(r[ix.created], year) : null) ?? null
      if (!date) { skipped++; continue }
      leads.push({
        wiseRef: `wise:lead:${phone ?? email}`,
        name: name || null, phone, email, date,
        sourceName: channel.source, product: channel.product, channelCertain: channel.certain,
        stage, statusRaw, statusKnown: known,
        notes: ix.activity >= 0 ? norm(r[ix.activity]) || null : null,
        rowIndex: i,
      })
      continue
    }

    if (kind === 'customers') {
      if (!name) { skipped++; continue }
      const nationalId = ix.nationalId >= 0 ? norm(r[ix.nationalId]) || null : null
      const amountRaw = ix.amount >= 0 ? String(r[ix.amount] ?? '').replace(/[^\d.-]/g, '') : ''
      const amount = amountRaw ? Number(amountRaw) : null
      customers.push({
        wiseRef: `wise:customer:${nationalId ?? phone ?? name}`,
        name, phone, email, nationalId,
        date: ix.created >= 0 ? toIsoDate(r[ix.created], year) : null,
        amount: Number.isFinite(amount) ? amount : null,
        rowIndex: i,
      })
      continue
    }

    // submissions — §4.5: "שם לקוח + בנק + תאריך" הוא מפתח השידוך.
    const bank = ix.bank >= 0 ? norm(r[ix.bank]) : ''
    if (!name || !bank) { skipped++; continue }
    const submittedAt = ix.submitted >= 0 ? toIsoDate(r[ix.submitted], year) : null
    submissions.push({
      wiseRef: `wise:sub:${name}|${bank}|${submittedAt ?? ''}`,
      clientName: name, bank,
      branch: ix.branch >= 0 ? norm(r[ix.branch]) || null : null,
      submittedAt,
      approvedAt: ix.approved >= 0 ? toIsoDate(r[ix.approved], year) : null,
      status: ix.status >= 0 ? norm(r[ix.status]) || null : null,
      rowIndex: i,
    })
  }

  if (unknown.size) {
    warnings.push(`${unknown.size} סטטוסים לא מוכרים נכנסו כ"ליד חדש": ${[...unknown].join(', ')}`)
  }
  if (kind === 'leads' && leads.some((l) => !l.channelCertain)) {
    const n = leads.filter((l) => !l.channelCertain).length
    warnings.push(`${n} לידים ללא זיהוי ערוץ ודאי — הערוץ נקבע לפי "מקור הפניה" וניתן לתקן במסך`)
  }

  return { kind, leads, customers, submissions, warnings, skipped, unknownStatuses: [...unknown] }
}

/** אותו ליד יכול להופיע פעמיים בייצוא — האחרון (הסטטוס המתקדם) גובר. */
export function dedupeLeads(leads: readonly WiseLead[]): WiseLead[] {
  const order: LeadStage[] = ['received', 'contacted', 'meeting', 'proposal', 'signed', 'closed_won', 'closed_lost']
  const byRef = new Map<string, WiseLead>()
  for (const l of leads) {
    const prev = byRef.get(l.wiseRef)
    if (!prev) { byRef.set(l.wiseRef, l); continue }
    // "אבוד" לא גובר על התקדמות אמיתית; חוץ מזה — השלב המתקדם יותר גובר.
    const better = order.indexOf(l.stage) > order.indexOf(prev.stage) && l.stage !== 'closed_lost'
    byRef.set(l.wiseRef, better ? l : prev)
  }
  return [...byRef.values()]
}
