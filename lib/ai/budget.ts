/**
 * תקרה יומית אחת לכל השימוש בתשלום ב-Claude API (דן, 16/10: 15 ₪ ליום לכל המערכות יחד).
 * מה שיכול לעבור דרך התור על המנוי — עובר שם (חינם). כאן נספר רק מה שהולך ל-API בתשלום:
 *   car_value — שווי רכב מיידי לפי יד 2 · sample — ניתוח מהדף כשצריך תשובה מיידית (דוח אשראי, מילוי שדות, סריקה)
 *   intake_analysis — ניתוח תיק, רק כשהתור לא חי · invoice — חילוץ חשבונית של ספק לא מוכר (ב.3)
 * לפני כל קריאה: שמירת מקום (reserve) לפי העלות המקסימלית שלה, בנעילת שורה — גם בכמה מופעים של השרת התקרה נשמרת.
 * אחרי הקריאה: settle לפי ה-usage האמיתי. נשמר ב-crm_docs: aiSpend/day-YYYY-MM-DD (שרת בלבד).
 */
import { sql, withActor } from '@/lib/db'

type Env = Record<string, string | undefined>
const envNum = (k: string, d: number, env: Env = process.env) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? v : d }
export const dailyCapIls = (env?: Env) => envNum('AI_DAILY_ILS', 15, env)
export const usdIls = (env?: Env) => envNum('USD_ILS', 3.7, env)
/** תשלום לחיפוש באינטרנט (USD) — לעדכן לפי המחירון של Anthropic */
export const searchUsd = (env?: Env) => envNum('AI_SEARCH_USD', 0.01, env)

/** מחירים לפי מיליון טוקנים (USD). כתיבת מטמון — הערכה (×1.25 מהקלט). מודל לא מוכר נספר לפי היקר. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}
const priceOf = (model: string) => PRICES[model] ?? PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? ''] ?? PRICES['claude-opus-5']!

export const FEATURES = {
  car_value: { label: 'שווי רכב לפי יד 2', maxIls: 1.5 },
  sample: { label: 'ניתוח מיידי מהדף (דוח אשראי, מילוי שדות, סריקה)', maxIls: 2.5 },
  intake_analysis: { label: 'ניתוח תיק (כשהתור על המנוי לא זמין)', maxIls: 3 },
  invoice: { label: 'חילוץ חשבונית של ספק לא מוכר', maxIls: 0.5 },
  property_value: { label: 'שווי נכס — חיפוש עסקאות ומודעות (רק כשהתור לא חי ו-PROPERTY_VALUE_PAID=1)', maxIls: 2.5 },
} as const
export type Feature = keyof typeof FEATURES

export interface UsageLike { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; server_tool_use?: { web_search_requests?: number | null } | null }

export function costIls(model: string, usages: UsageLike[], env?: Env): number {
  const p = priceOf(model)
  let usd = 0
  for (const u of usages) {
    usd += ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1e6
      + (u.server_tool_use?.web_search_requests ?? 0) * searchUsd(env)
  }
  return Math.round(usd * usdIls(env) * 100) / 100
}

export interface DaySpend { date: string; ils: number; reserved: number; calls: number; byFeature: Partial<Record<Feature, { ils: number; calls: number }>> }
export const dayKey = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
const empty = (date: string): DaySpend => ({ date, ils: 0, reserved: 0, calls: 0, byFeature: {} })
const r2 = (x: number) => Math.round(x * 100) / 100

/** כמה מקום נשאר — פונקציה טהורה */
export function canSpend(s: DaySpend, maxIls: number, cap: number): boolean { return s.ils + s.reserved + maxIls <= cap + 1e-9 }

export async function spendOf(date = dayKey()): Promise<DaySpend> {
  const [r] = await sql<{ data: DaySpend }[]>`select data from crm_docs where coll = 'aiSpend' and doc_id = ${'day-' + date} and deleted_at is null`
  return r?.data ? { ...empty(date), ...r.data } : empty(date)
}

async function mutate(date: string, fn: (s: DaySpend) => DaySpend | null): Promise<DaySpend | null> {
  return withActor(async (tx) => {
    const id = 'day-' + date
    await tx`insert into crm_docs (coll, doc_id, data, source) values ('aiSpend', ${id}, ${tx.json(empty(date) as never)}, 'app') on conflict (coll, doc_id) do nothing`
    const [cur] = await tx<{ data: DaySpend }[]>`select data from crm_docs where coll = 'aiSpend' and doc_id = ${id} for update`
    const next = fn({ ...empty(date), ...(cur?.data ?? {}) })
    if (!next) return null
    await tx`update crm_docs set data = ${tx.json(next as never)}, deleted_at = null, seq = nextval('crm_docs_seq') where coll = 'aiSpend' and doc_id = ${id}`
    return next
  })
}

export interface Reservation { feature: Feature; date: string; maxIls: number }
export type ReserveResult = { ok: true; r: Reservation } | { ok: false; spent: number; cap: number; message: string }

/** שומר מקום לקריאה אחת. false = הגענו לתקרה — לא קוראים ל-API. */
export async function reserve(feature: Feature, env?: Env): Promise<ReserveResult> {
  const date = dayKey(), maxIls = FEATURES[feature].maxIls, cap = dailyCapIls(env)
  const s = await mutate(date, (s) => (canSpend(s, maxIls, cap) ? { ...s, reserved: r2(s.reserved + maxIls) } : null))
  if (s) return { ok: true, r: { feature, date, maxIls } }
  const now = await spendOf(date)
  const left = Math.max(0, cap - now.ils - now.reserved)
  return { ok: false, spent: now.ils, cap, message: `תקרת Claude API להיום: נוצלו ${now.ils.toFixed(2)} מתוך ${cap} ₪, נשארו ${left.toFixed(2)} ₪ — לא מספיק לבדיקה הזו (עד ${maxIls} ₪). מחר שוב, או דרך התור על המנוי` }
}

/** סוגר את שמירת המקום לפי העלות בפועל (גם 0 כשהקריאה נכשלה לפני חיוב). */
export async function settle(r: Reservation, actualIls: number): Promise<DaySpend | null> {
  const c = Math.max(0, r2(actualIls))
  return mutate(r.date, (s) => {
    const f = s.byFeature[r.feature] ?? { ils: 0, calls: 0 }
    return { ...s, ils: r2(s.ils + c), reserved: Math.max(0, r2(s.reserved - r.maxIls)), calls: s.calls + 1, byFeature: { ...s.byFeature, [r.feature]: { ils: r2(f.ils + c), calls: f.calls + 1 } } }
  })
}

/** ניצול ל-N ימים אחרונים (לכרטיס בהגדרות) */
export async function recentSpend(days = 30): Promise<DaySpend[]> {
  const rows = await sql<{ data: DaySpend }[]>`select data from crm_docs where coll = 'aiSpend' and doc_id like 'day-%' and deleted_at is null order by doc_id desc limit ${days}`
  return rows.map((r) => ({ ...empty(r.data.date), ...r.data }))
}
