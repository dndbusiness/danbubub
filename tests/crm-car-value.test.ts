import { describe, it, expect } from 'vitest'
import { carValuePrompt, costIls, dailyCapIls, parseValuation, runCarValuation } from '@/lib/crm/car-value'

describe('car value', () => {
  it('prompt names the car and asks for yad2 + JSON only', () => {
    const p = carValuePrompt({ maker: 'טויוטה', model: 'קורולה', year: 2021, km: 60000, hand: 2 })
    expect(p).toContain('טויוטה קורולה 2021'); expect(p).toContain('yad2'); expect(p).toContain('60000 ק״מ'); expect(p).toContain('JSON')
  })
  it('parses a fenced JSON answer and keeps only https links', () => {
    const v = parseValuation('בדקתי.\n```json\n{"low": 80000, "mid": "88,000", "high": 95000, "listings": [{"title": "קורולה 2021", "url": "https://www.yad2.co.il/item/abc", "price": 89000, "year": 2021}, {"title": "x", "url": "javascript:alert(1)", "price": 90000}], "basis": "4 מודעות", "confidence": "medium"}\n```')
    expect(v).toMatchObject({ low: 80000, mid: 88000, high: 95000, confidence: 'medium', basis: '4 מודעות' })
    expect(v!.listings[0]!.url).toBe('https://www.yad2.co.il/item/abc'); expect(v!.listings[1]!.url).toBe('')
  })
  it('derives mid/low/high from listings when missing; null when nothing usable', () => {
    const v = parseValuation('{"listings": [{"url": "https://a", "price": 70000}, {"url": "https://b", "price": 90000}, {"url": "https://c", "price": 80000}]}')
    expect(v).toMatchObject({ low: 70000, mid: 80000, high: 90000, confidence: 'low' })
    expect(parseValuation('אין מודעות')).toBeNull()
  })
  it('computes cost in ILS from usage and search count', () => {
    const env = { USD_ILS: '4', CAR_VALUE_SEARCH_USD: '0.01' }
    expect(costIls([{ input_tokens: 100_000, output_tokens: 2_000, server_tool_use: { web_search_requests: 3 } }], env)).toBe(Math.round((0.2 + 0.02 + 0.03) * 4 * 100) / 100)
    expect(dailyCapIls({})).toBe(10); expect(dailyCapIls({ CAR_VALUE_DAILY_ILS: '5' })).toBe(5)
  })
  it('resumes pause_turn and collects usage', async () => {
    let n = 0
    const fake = { messages: { create: async () => (++n === 1
      ? { stop_reason: 'pause_turn', content: [], usage: { input_tokens: 10, output_tokens: 1 } }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"mid": 50000}' }], usage: { input_tokens: 20, output_tokens: 2 } }) } }
    const r = await runCarValuation({ maker: 'a', model: 'b', year: 2020 }, fake as never)
    expect(n).toBe(2); expect(r.usages).toHaveLength(2); expect(parseValuation(r.text)!.mid).toBe(50000)
  })
})
