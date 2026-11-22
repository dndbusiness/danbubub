import { describe, expect, it } from 'vitest'
import { keyRejected, llmAvailable, markKeyRejected } from '@/lib/intake/llm'

/** דן 22/11: "401 invalid x-api-key" — אחרי דחייה המפתח לא נחשב זמין 10 דקות (הבקשות עוברות לתור) */
describe('מפתח Claude שנדחה', () => {
  it('מפתח מוגדר = זמין; אחרי 401 — לא, ל-10 דקות', () => {
    expect(llmAvailable({ ANTHROPIC_API_KEY: 'x' })).toBe(true)
    const t = Date.now(); markKeyRejected(t)
    expect(keyRejected(t + 60e3)).toBe(true)
    expect(keyRejected(t + 11 * 60e3)).toBe(false)
    expect(llmAvailable({ ANTHROPIC_API_KEY: 'x' })).toBe(true) /* סביבה מפורשת (בדיקות) — לא מושפעת */
  })
})
