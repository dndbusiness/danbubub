/**
 * הערכת שווי נכס — חיפוש עסקאות, מודעות, מחירי יזמים וגורמים משפיעים (docs/HAREL_VALUATION_SPEC.md §13).
 * ברירת המחדל: התור על המנוי (Claude Code עם חיפוש באינטרנט, תשובה תוך דקות) — החלטת דן 16/10.
 * חלופה בתשלום (API עם web_search) רק כש-PROPERTY_VALUE_PAID=1 והתור לא חי, בתוך התקרה המשותפת (lib/ai/budget.ts).
 * מה שחוזר הוא הצעה בלבד (הנחיה 17): הדף מציג, אדם מאשר כל שורה לפני שהיא נכנסת לחישוב.
 * valSearchPrompt ו-cleanPropertySearch זהים לאלה שבדף (crm/harel-crm.html) — נבדק ב-tests/crm-valuation.test.ts.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { UsageLike } from '@/lib/ai/budget'

export const PROPERTY_VALUE_MODEL = 'claude-sonnet-5-5'

export interface PropSubject { address?: string; type?: string; rooms?: number | null; area?: number | null; floor?: number | null; kind?: 'second' | 'new' | ''; gush?: string; helka?: string }
export interface SearchDeal { date: string; address: string; rooms: number | null; area: number | null; floor: number | null; price: number; kind: 'second' | 'new' | ''; url: string; src: string }
export interface SearchListing { title: string; address: string; price: number; rooms: number | null; area: number | null; floor: number | null; date: string; url: string; src: string }
export interface SearchDev { project: string; developer: string; ppsqm: number | null; price: number | null; rooms: number | null; area: number | null; url: string }
export interface SearchFactor { text: string; dir: 'up' | 'down' | 'risk'; url: string }
export interface PropertySearch { deals: SearchDeal[]; listings: SearchListing[]; developers: SearchDev[]; factors: SearchFactor[]; market: string; note: string }

/* ══ זהה לדף — אל לשנות בלי לשנות שם (בדיקת זהות ב-tests/crm-valuation.test.ts) ══ */
const VAL_TYPE_HE: Record<string, string> = { apartment: 'דירה', garden: 'דירת גן', penthouse: 'גג / פנטהאוז', cottage: 'קוטג׳ / דו-משפחתי', house: 'בית פרטי', land: 'מגרש', commercial: 'מסחרי / משרד' }
export function valSearchPrompt(s: PropSubject): string {
  const what = [VAL_TYPE_HE[s.type || ''] || 'נכס', s.rooms ? s.rooms + ' חדרים' : '', s.area ? s.area + ' מ״ר' : '', s.floor != null && String(s.floor) !== '' ? 'קומה ' + s.floor : '', s.kind === 'new' ? 'חדש מקבלן' : s.kind === 'second' ? 'יד שנייה' : ''].filter(Boolean).join(' · ')
  return [
    '## חיפוש ברשת: מותר (קריאה בלבד)',
    'בקשה זו מתירה להשתמש בחיפוש באינטרנט ובקריאת דפים — לקריאה בלבד. אסור לשלוח טפסים, להירשם או לפעול בשום אתר.',
    '',
    'משימה: לאסוף נתוני שוק לנכס בישראל, לצורך הערכת שווי פנימית של יועץ משכנתאות.',
    'הנכס: ' + (s.address || '—') + (s.gush ? ' · גוש ' + s.gush + (s.helka ? ' חלקה ' + s.helka : '') : '') + ' · ' + (what || '—') + '.',
    '',
    'חפש, לפי סדר החשיבות:',
    '1. עסקאות שבוצעו (מכירות רשומות ברשות המסים) בבניין, ברחוב ובשכונה — 36 החודשים האחרונים. מקורות: nadlan.gov.il, ודפי עסקאות באתרים שמציגים את נתוני רשות המסים (מדלן, אתרי שמאים ותיווך). עסקה = תאריך, כתובת, חדרים, שטח, קומה, מחיר, ואם ידוע: חדש מקבלן או יד שנייה.',
    '2. מודעות למכירה עכשיו של נכסים דומים באזור (יד2, מדלן, אתרי תיווך) — מחיר מבוקש בלבד.',
    '3. פרויקטים חדשים של יזמים באזור ומחירם (למ״ר או לדירה).',
    '4. גורמים שיכולים להשפיע על השווי: התחדשות עירונית (תמ״א 38, פינוי-בינוי), תב״ע חדשה, תחבורה (רכבת קלה / תחנה), מטרדים, הפקעות.',
    '5. משפט אחד על מצב השוק באזור (מגמת מחירים, קצב עסקאות), רק אם יש לך מקור.',
    '',
    'כללים: אל תמציא עסקאות, מחירים, כתובות או קישורים — רק מה שראית בפועל בתוצאות או בדפים. לכל שורה צרף את הקישור שבו ראית אותה. אם לא מצאת — החזר רשימה ריקה וכתוב מה חסר ב-note. מחיר מבוקש אינו עסקה — אל תכניס מודעות לרשימת העסקאות.',
    '',
    'החזר JSON בלבד, בלי טקסט לפניו או אחריו, במבנה:',
    '{"deals":[{"date":"YYYY-MM-DD","address":"רחוב מספר, עיר","rooms":מספר או null,"area":מספר או null,"floor":מספר או null,"price":מספר,"kind":"second|new|","url":"https://…","src":"שם המקור"}],',
    ' "listings":[{"title":"…","address":"…","price":מספר,"rooms":מספר או null,"area":מספר או null,"floor":מספר או null,"date":"YYYY-MM-DD או ריק","url":"https://…","src":"יד2 / מדלן / …"}],',
    ' "developers":[{"project":"…","developer":"…","ppsqm":מספר או null,"price":מספר או null,"rooms":מספר או null,"area":מספר או null,"url":"https://…"}],',
    ' "factors":[{"text":"…","dir":"up|down|risk","url":"https://…"}],',
    ' "market":"משפט אחד או ריק","note":"מה לא נמצא / הסתייגויות"}',
    'מחירים בש״ח, מספרים שלמים.',
  ].join('\n')
}
function cleanNum(v: unknown, min: number, max: number): number | null {
  const x = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(x) && x >= min && x <= max ? x : null
}
function cleanUrl(v: unknown): string { const u = String(v ?? '').trim(); return /^https:\/\/[^\s"'<>]+$/.test(u) ? u.slice(0, 500) : '' }
function cleanDate(v: unknown): string { const m = String(v ?? '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '' }
const cleanTxt = (v: unknown, k: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, k)
export function cleanPropertySearch(j: unknown): PropertySearch {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>, arr = (k: string) => (Array.isArray(o[k]) ? o[k] as Record<string, unknown>[] : []).filter((x) => x && typeof x === 'object')
  const kindOf = (v: unknown): 'second' | 'new' | '' => (v === 'second' || v === 'new' ? v : '')
  const deals = arr('deals').map((d) => ({ date: cleanDate(d.date), address: cleanTxt(d.address, 120), rooms: cleanNum(d.rooms, 1, 20), area: cleanNum(d.area, 15, 2000), floor: cleanNum(d.floor, -2, 80), price: Math.round(cleanNum(d.price, 50000, 200000000) ?? 0), kind: kindOf(d.kind), url: cleanUrl(d.url), src: cleanTxt(d.src, 60) }))
    .filter((d) => d.price && d.date && d.url).slice(0, 40)
  const listings = arr('listings').map((d) => ({ title: cleanTxt(d.title, 140), address: cleanTxt(d.address, 120), price: Math.round(cleanNum(d.price, 50000, 200000000) ?? 0), rooms: cleanNum(d.rooms, 1, 20), area: cleanNum(d.area, 15, 2000), floor: cleanNum(d.floor, -2, 80), date: cleanDate(d.date), url: cleanUrl(d.url), src: cleanTxt(d.src, 40) }))
    .filter((d) => d.price && d.url).slice(0, 20)
  const developers = arr('developers').map((d) => ({ project: cleanTxt(d.project, 100), developer: cleanTxt(d.developer, 80), ppsqm: cleanNum(d.ppsqm, 2000, 300000), price: cleanNum(d.price, 50000, 200000000), rooms: cleanNum(d.rooms, 1, 20), area: cleanNum(d.area, 15, 2000), url: cleanUrl(d.url) }))
    .filter((d) => (d.ppsqm || d.price) && d.url && d.project).slice(0, 12)
  const factors = arr('factors').map((d) => ({ text: cleanTxt(d.text, 240), dir: (['up', 'down', 'risk'].includes(String(d.dir)) ? d.dir : 'risk') as SearchFactor['dir'], url: cleanUrl(d.url) }))
    .filter((d) => d.text && d.url).slice(0, 12)
  return { deals, listings, developers, factors, market: cleanTxt(o.market, 300), note: cleanTxt(o.note, 400) }
}
/* ══ סוף החלק הזהה לדף ══ */

/** מוציא JSON מתשובה (גם בתוך ```json) */
export function parsePropertySearch(text: string): PropertySearch | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/), raw = m ? (m[1] ?? '') : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try { return cleanPropertySearch(JSON.parse(raw)) } catch { return null }
}

/** החלופה בתשלום: Claude עם חיפוש באינטרנט. רק כש-PROPERTY_VALUE_PAID=1 */
export const paidEnabled = (env: Record<string, string | undefined> = process.env) => env.PROPERTY_VALUE_PAID === '1'

export async function runPropertySearch(s: PropSubject, client: Pick<Anthropic, 'messages'> = new Anthropic()): Promise<{ text: string; usages: UsageLike[] }> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: valSearchPrompt(s) }]
  const usages: UsageLike[] = []
  let text = ''
  for (let i = 0; i < 3; i++) {
    const res = await client.messages.create({
      model: PROPERTY_VALUE_MODEL,
      max_tokens: 6000,
      output_config: { effort: 'low' },
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: { type: 'approximate', country: 'IL' } },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 },
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
