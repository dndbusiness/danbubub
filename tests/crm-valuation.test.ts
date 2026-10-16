import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanPropertySearch, parsePropertySearch, runPropertySearch, valSearchPrompt, type PropSubject } from '@/lib/crm/property-value'

/** מנוע הערכת השווי מהדף (crm/harel-crm.html) — אותו קוד שרץ במסך, בלי DOM */
type Deal = { date: string; address?: string; rooms?: number | null; area?: number | null; floor?: number | null; price: number; kind?: string; share?: number; off?: boolean }
type Subject = { address?: string; type?: string; rooms?: number | null; area?: number | null; floor?: number | string | null; kind?: string; gush?: string; helka?: string }
type Base = { used: { i: number; ring: number; x: number }[]; excluded: { i: number; why: string }[]; ring: number; n: number; mode: string; med: number; value: number; low: number; high: number; confidence: string; floorPct: number; deep: boolean; warns: string[] }
type Fin = { steps: { k: string; pct: number }[]; pct: number; open: number; value: number; low: number; high: number }
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ הערכת שווי — מנוע'), b = html.indexOf('/* ══ סוף מנוע הערכת שווי ══ */')
const E = new Function('const n = (v) => Number(v || 0);\n' + html.slice(a, b) + '; return { valCompute, valFinal, valQuestions, valLtv, valParseDeals, valSearchPrompt, valCleanSearch };')() as {
  valCompute: (s: Subject, d: Deal[], o: { asOf: string; indexPctYear?: number; minN?: number }) => Base
  valFinal: (b: Base, s: Subject, ans: Record<string, string>) => Fin | null
  valQuestions: (s: Subject) => { k: string }[]
  valLtv: (loan: number, f: Fin, t: string) => { onLow: number; limit: number; over: boolean; equity: number } | null
  valParseDeals: (t: string) => Deal[]
  valSearchPrompt: (s: PropSubject) => string
  valCleanSearch: (j: unknown) => unknown
}
const asOf = '2026-10-16'

describe('valuation engine (page)', () => {
  it('the block exists in the page', () => { expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a) })

  it('נתניה, קוטג׳ (דוגמת השמאות): החריג 6.52M נפסל, החציון 3,802,000, ביטחון נמוך והפניה לבדיקה מעמיקה', () => {
    const prices = [3570733, 3658537, 3793906, 3810345, 4300000, 4390244, 6520000]
    const r = E.valCompute({ address: 'הדס 5, נתניה', type: 'cottage', area: 110 }, prices.map((price, i) => ({ date: '2025-0' + (i + 1) + '-10', address: 'הדס ' + (i + 1) + ', נתניה', price })), { asOf })
    expect(r.n).toBe(6); expect(r.mode).toBe('price'); expect(r.value).toBe(3802000)
    expect(r.excluded.map((x) => x.i)).toEqual([6])
    expect(r.confidence).toBe('low'); expect(r.deep).toBe(true); expect(r.warns.join(' ')).toContain('בדיקה מעמיקה')
  })

  it('רמת גן: העסקה היחידה בבניין (₪19K למ״ר מול ₪36–40K ברחוב) נפסלת כלא-שוק, והבסיס הוא הרחוב', () => {
    const s = { address: 'ביאליק 10, רמת גן', type: 'apartment', rooms: 3, area: 66, floor: 2, kind: 'second' }
    const deals: Deal[] = [
      { date: '2025-05-01', address: 'ביאליק 10, רמת גן', rooms: 3, area: 65, floor: 1, price: 1250000 },
      { date: '2025-02-01', address: 'ביאליק 4, רמת גן', rooms: 3, area: 64, floor: 2, price: 2304000 },
      { date: '2025-06-01', address: 'ביאליק 22, רמת גן', rooms: 3, area: 70, floor: 3, price: 2800000 },
      { date: '2025-09-01', address: 'ביאליק 15, רמת גן', rooms: 3.5, area: 68, floor: 2, price: 2516000 },
      { date: '2026-01-01', address: 'ביאליק 8, רמת גן', rooms: 3, area: 62, floor: 1, price: 2418000 },
      { date: '2026-03-01', address: 'ביאליק 31, רמת גן', rooms: 2.5, area: 60, floor: 4, price: 2280000 },
    ]
    const r = E.valCompute(s, deals, { asOf })
    expect(r.ring).toBe(1); expect(r.mode).toBe('sqm')
    expect(r.excluded.find((x) => x.i === 0)!.why).toContain('40%')
    expect(r.n).toBe(5); expect(r.med).toBe(38000); expect(r.value).toBe(2508000)
    expect(r.low).toBe(2442000); expect(r.high).toBe(2574000); expect(r.confidence).toBe('medium')
  })

  it('סינון: חדרים ±1, שטח ±25%, 36 חודשים, חלק מנכס, חדש מול יד שנייה, הוצאה ידנית', () => {
    const s = { address: 'הרצל 1, חיפה', type: 'apartment', rooms: 4, area: 100, kind: 'second' }
    const base: Deal = { date: '2025-01-01', address: 'הרצל 3, חיפה', rooms: 4, area: 100, price: 1500000 }
    const r = E.valCompute(s, [
      { ...base, rooms: 6 }, { ...base, area: 130 }, { ...base, date: '2022-01-01' }, { ...base, share: 0.5 }, { ...base, kind: 'new' }, { ...base, off: true }, base,
    ], { asOf })
    const why = Object.fromEntries(r.excluded.map((x) => [x.i, x.why]))
    expect(why[0]).toContain('חדרים'); expect(why[1]).toContain('שטח'); expect(why[2]).toContain('36'); expect(why[3]).toContain('חלק')
    expect(why[4]).toContain('חדש'); expect(why[5]).toContain('ידנית'); expect(r.n).toBe(1)
    expect(r.confidence).toBe('low')
  })

  it('הצמדה: עסקה בת שנה עולה באחוז ההצמדה', () => {
    const r = E.valCompute({ address: 'א 1, ב', type: 'apartment' }, [{ date: '2025-10-16', address: 'א 2, ב', price: 1000000 }], { asOf, indexPctYear: 5 })
    expect(r.value).toBe(1050000)
  })

  it('שאלות: כל תשובה מזיזה את השווי ומצמצמת את הטווח', () => {
    const s = { address: 'ביאליק 10, רמת גן', type: 'apartment', rooms: 3, area: 100, floor: 1 }
    const deals = [1, 2, 3, 4, 5, 6].map((k) => ({ date: '2026-0' + k + '-01', address: 'ביאליק ' + (k * 2) + ', רמת גן', rooms: 3, area: 100, floor: 1, price: 2000000 + k * 20000 }))
    const base = E.valCompute(s, deals, { asOf })
    const open = E.valFinal(base, s, {})!, some = E.valFinal(base, s, { finish: 'high', parking: 'reg' })!
    expect(open.value).toBe(base.value); expect(open.low).toBeLessThan(base.low)
    expect(some.pct).toBe(9); expect(some.value).toBe(Math.round(base.value * 1.09 / 1000) * 1000)
    expect(some.high - some.low).toBeLessThan((open.high - open.low) * 1.09)
    expect(E.valQuestions({ type: 'house' }).map((q) => q.k)).not.toContain('parking')
    expect(E.valFinal({ ...base, value: 0 }, s, {})).toBeNull()
  })

  it('אחוז מימון מול הגבול התחתון', () => {
    const f = { steps: [], pct: 0, open: 0, value: 2000000, low: 1800000, high: 2200000 }
    expect(E.valLtv(1260000, f, 'single')).toMatchObject({ onLow: 70, limit: 75, over: false, equity: 0 })
    expect(E.valLtv(1260000, f, 'invest')).toMatchObject({ onLow: 70, limit: 50, over: true, equity: 360000 })
    expect(E.valLtv(0, f, 'single')).toBeNull()
  })

  it('הדבקת טבלה: תאריך, מחיר, חדרים, שטח; שורה בלי מחיר נזרקת', () => {
    const r = E.valParseDeals('12/03/2025  הרצל 10, קריית ים  4  92  1,950,000\n2024-11-02 שז״ר 5 5 120 ₪2,300,000 חדש מקבלן\nסתם שורה 123')
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ date: '2025-03-12', rooms: 4, area: 92, price: 1950000 })
    expect(r[1]).toMatchObject({ date: '2024-11-02', rooms: 5, area: 120, price: 2300000, kind: 'new' })
  })
})

describe('property search — same in the page and the server', () => {
  const subjects: PropSubject[] = [
    { address: 'ביאליק 10, רמת גן', type: 'apartment', rooms: 3, area: 66, floor: 2, kind: 'second', gush: '6124', helka: '55' },
    { address: 'הדס 5, נתניה', type: 'cottage', rooms: null, area: null, floor: null, kind: '' },
    { address: 'x', floor: 0, kind: 'new' },
  ]
  it('the prompt is identical', () => { for (const s of subjects) expect(E.valSearchPrompt(s)).toBe(valSearchPrompt(s)) })
  it('the prompt allows web search and forbids inventing', () => {
    const p = valSearchPrompt(subjects[0]!)
    expect(p.startsWith('## חיפוש ברשת: מותר')).toBe(true); expect(p).toContain('nadlan.gov.il'); expect(p).toContain('אל תמציא'); expect(p).toContain('גוש 6124 חלקה 55')
  })
  const raw = {
    deals: [
      { date: '2025-03-12', address: 'הרצל 10', rooms: '4', area: 92, floor: 1, price: '1,950,000', kind: 'second', url: 'https://www.nadlan.gov.il/x', src: 'רשות המסים' },
      { date: '2025-03-12', address: 'בלי קישור', price: 1900000, url: '' },
      { date: 'אתמול', address: 'בלי תאריך', price: 1900000, url: 'https://a.b' },
      { date: '2025-01-01', address: 'קישור זדוני', price: 1900000, url: 'javascript:alert(1)' },
    ],
    listings: [{ title: 'דירת 4 חד׳', price: 2100000, url: 'https://www.yad2.co.il/item/1', src: 'יד2' }, { title: 'בלי מחיר', url: 'https://a.b' }],
    developers: [{ project: 'פרויקט', developer: 'יזם', ppsqm: 28000, url: 'https://dev.example/p' }, { project: '', ppsqm: 28000, url: 'https://x.y' }],
    factors: [{ text: 'פינוי-בינוי מאושר ברחוב', dir: 'up', url: 'https://gov.example/t' }, { text: 'בלי מקור', dir: 'down', url: '' }, { text: 'כיוון לא ידוע', dir: 'sideways', url: 'https://q.r' }],
    market: '  מחירים יציבים  ', note: 'לא נמצאו עסקאות בבניין',
  }
  it('the cleaner is identical and drops rows without a source', () => {
    expect(E.valCleanSearch(raw)).toEqual(cleanPropertySearch(raw))
    const c = cleanPropertySearch(raw)
    expect(c.deals).toEqual([{ date: '2025-03-12', address: 'הרצל 10', rooms: 4, area: 92, floor: 1, price: 1950000, kind: 'second', url: 'https://www.nadlan.gov.il/x', src: 'רשות המסים' }])
    expect(c.listings).toHaveLength(1); expect(c.developers).toHaveLength(1)
    expect(c.factors.map((f) => f.dir)).toEqual(['up', 'risk']); expect(c.market).toBe('מחירים יציבים')
    expect(E.valCleanSearch(null)).toEqual(cleanPropertySearch(null))
  })
  it('parses a fenced answer; garbage → null', () => {
    expect(parsePropertySearch('הנה:\n```json\n' + JSON.stringify(raw) + '\n```')!.deals).toHaveLength(1)
    expect(parsePropertySearch('לא מצאתי')).toBeNull()
  })
  it('paid path: resumes pause_turn, uses web search tools', async () => {
    let calls = 0; const seen: unknown[] = []
    const fake = { messages: { create: async (req: { tools: { type: string }[] }) => { seen.push(req.tools.map((t) => t.type)); return ++calls === 1
      ? { stop_reason: 'pause_turn', content: [], usage: { input_tokens: 10, output_tokens: 1 } }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(raw) }], usage: { input_tokens: 20, output_tokens: 2 } } } } }
    const r = await runPropertySearch(subjects[0]!, fake as never)
    expect(calls).toBe(2); expect(r.usages).toHaveLength(2); expect(seen[0]).toEqual(['web_search_20260209', 'web_fetch_20260209'])
    expect(parsePropertySearch(r.text)!.deals).toHaveLength(1)
  })
})
