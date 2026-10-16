/**
 * שווי רכב מיידי לפי מודעות יד 2 — Claude עם חיפוש באינטרנט (דן, 16/10).
 * התוצאה היא הצעה בלבד (הנחיה 17): הדף מציג טווח + מודעות, ואדם מאשר לפני שזה נרשם בתיק.
 * העלות נספרת בתקרה היומית המשותפת (lib/ai/budget.ts). החלקים הטהורים כאן נבדקים ב-tests/crm-car-value.test.ts.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { UsageLike } from '@/lib/ai/budget'

export const CAR_VALUE_MODEL = 'claude-sonnet-5-5'
/* העלות והתקרה — בתקרה המשותפת של כל ה-API (lib/ai/budget.ts, 15 ₪ ליום) */

export interface CarQuery { maker?: string; model?: string; trim?: string; year?: number | null; km?: number | null; hand?: number | null; fuel?: string; plate?: string }
export interface Listing { title: string; url: string; price: number | null; year: number | null; km: number | null; hand: number | null }
export interface Valuation { low: number | null; mid: number | null; high: number | null; listings: Listing[]; basis: string; note: string; confidence: 'high' | 'medium' | 'low' }

export const carLabel = (q: CarQuery) => [q.maker, q.model, q.trim, q.year].filter(Boolean).join(' ')

export function carValuePrompt(q: CarQuery): string {
  return [
    'הערך את שווי השוק של רכב יד שנייה בישראל לפי מודעות למכירה ביד 2 (yad2.co.il).',
    `הרכב: ${carLabel(q) || '—'}${q.km ? ` · ${q.km} ק״מ` : ''}${q.hand ? ` · יד ${q.hand}` : ''}${q.fuel ? ` · ${q.fuel}` : ''}.`,
    'חפש מודעות של אותו יצרן, דגם ושנתון (שנה אחת לכל כיוון אם אין מספיק), וקח 3–6 מודעות דומות. אם אין מודעות נגישות — אפשר מחירון יד 2 או מחירון פתוח אחר, וכתוב את זה ב-basis.',
    'אל תמציא מודעות, מחירים או קישורים: רק מה שראית בתוצאות החיפוש.',
    'החזר בסוף JSON בלבד, בלי טקסט נוסף, במבנה:',
    '{"low": מספר, "mid": מספר, "high": מספר, "listings": [{"title": "...", "url": "https://...", "price": מספר, "year": מספר או null, "km": מספר או null, "hand": מספר או null}], "basis": "על מה מבוסס (כמה מודעות, איזה מקור)", "note": "הסתייגויות קצרות", "confidence": "high|medium|low"}',
    'המחירים בש״ח, מספרים שלמים. mid = ההערכה לרכב הזה (לא ממוצע עיוור — לפי ק״מ ויד אם ידוע).',
  ].join('\n')
}

const num = (v: unknown): number | null => { const x = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && x > 0 ? Math.round(x) : null }

/** מוציא את ה-JSON מהתשובה (גם בתוך ```json) ומנקה. קישורים — רק https. */
export function parseValuation(text: string): Valuation | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/), raw = m ? (m[1] ?? '') : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let j: Record<string, unknown>
  try { j = JSON.parse(raw) } catch { return null }
  if (!j || typeof j !== 'object') return null
  const listings = (Array.isArray(j.listings) ? j.listings : []).map((l: Record<string, unknown>) => ({
    title: String(l?.title ?? '').slice(0, 160), url: /^https:\/\//.test(String(l?.url ?? '')) ? String(l.url) : '',
    price: num(l?.price), year: num(l?.year), km: num(l?.km), hand: num(l?.hand),
  })).filter((l) => l.url || l.price).slice(0, 8)
  let low = num(j.low), mid = num(j.mid), high = num(j.high)
  const prices = listings.map((l) => l.price).filter((p): p is number => !!p).sort((a, b) => a - b)
  if (!mid && prices.length) mid = prices[Math.floor(prices.length / 2)] ?? null
  if (!low && prices.length) low = prices[0] ?? null
  if (!high && prices.length) high = prices[prices.length - 1] ?? null
  if (!mid) return null
  const conf = ['high', 'medium', 'low'].includes(String(j.confidence)) ? j.confidence as Valuation['confidence'] : 'low'
  return { low, mid, high, listings, basis: String(j.basis ?? '').slice(0, 400), note: String(j.note ?? '').slice(0, 400), confidence: conf }
}

/** קריאה ל-Claude עם חיפוש באינטרנט. מחזיר את הטקסט וכל ה-usage (לחישוב עלות). */
export async function runCarValuation(q: CarQuery, client: Pick<Anthropic, 'messages'> = new Anthropic()): Promise<{ text: string; usages: UsageLike[] }> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: carValuePrompt(q) }]
  const usages: UsageLike[] = []
  let text = ''
  for (let i = 0; i < 3; i++) {
    const res = await client.messages.create({
      model: CAR_VALUE_MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', country: 'IL' } },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
      ],
      messages,
    })
    usages.push(res.usage as UsageLike)
    text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n')
    if (res.stop_reason === 'refusal') throw Object.assign(new Error('Claude סירב לבקשה'), { code: 'refused' })
    if (res.stop_reason !== 'pause_turn') break
    messages.push({ role: 'assistant', content: res.content })
  }
  return { text, usages }
}
