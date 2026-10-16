import { describe, it, expect } from 'vitest'
import { canSpend, costIls, dailyCapIls, FEATURES, PRICES } from '@/lib/ai/budget'

describe('shared Claude API budget', () => {
  it('cap defaults to 15 ILS and is configurable', () => {
    expect(dailyCapIls({})).toBe(15)
    expect(dailyCapIls({ AI_DAILY_ILS: '20' })).toBe(20)
  })
  it('costs tokens by model and web searches', () => {
    const env = { USD_ILS: '4', AI_SEARCH_USD: '0.01' }
    expect(costIls('claude-sonnet-5-5', [{ input_tokens: 100_000, output_tokens: 2_000, server_tool_use: { web_search_requests: 3 } }], env)).toBe(Math.round((0.2 + 0.02 + 0.03) * 4 * 100) / 100)
    expect(costIls('claude-opus-5-5', [{ input_tokens: 1_000_000 }], env)).toBe(16)
    expect(costIls('claude-opus-5-5-20261001', [{ output_tokens: 1_000_000 }], env)).toBe(80)
    expect(costIls('unknown-model', [{ input_tokens: 1_000_000 }], env)).toBe(PRICES['claude-opus-5']!.input * 4)
  })
  it('never lets reserved + spent + next call pass the cap', () => {
    const s = { date: 'd', ils: 12, reserved: 1.5, calls: 3, byFeature: {} }
    expect(canSpend(s, FEATURES.car_value.maxIls, 15)).toBe(true)
    expect(canSpend(s, FEATURES.sample.maxIls, 15)).toBe(false)
    expect(canSpend({ ...s, ils: 15, reserved: 0 }, 0.5, 15)).toBe(false)
  })
})
