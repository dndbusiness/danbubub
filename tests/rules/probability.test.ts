import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE_PROBABILITY,
  isCommittedStage,
  stageProbability,
} from '@/lib/rules/probability.js'

const ASOF = '2026-09-18'

describe('הסתברות לפי שלב — SPEC §2.3', () => {
  it.each([
    ['prospect', 0],
    ['signed_collecting_docs', 0.3],
    ['submitted', 0.5],
    ['approved_in_principle', 0.7],
    ['appraisal', 0.85],
    ['execution', 0.95],
    ['completed', 1],
  ] as const)('%s → %s', (stage, expected) => {
    expect(DEFAULT_STAGE_PROBABILITY[stage]).toBe(expected)
  })

  it('שלב "הושלם" הופך את הצפי ל-committed', () => {
    expect(isCommittedStage('completed')).toBe(true)
    expect(isCommittedStage('submitted')).toBe(false)
  })

  it('דריסה ידנית גוברת על השלב', () => {
    const r = stageProbability({ stage: 'prospect', probabilityOverride: 0.9 }, ASOF)
    expect(r.probability).toBe(0.9)
  })

  it('כיול בהגדרות גובר על ברירת המחדל', () => {
    const r = stageProbability({ stage: 'submitted' }, ASOF, { submitted: 0.6 })
    expect(r.probability).toBe(0.6)
  })
})

describe('רקב — SPEC §2.3', () => {
  it('פחות מ-30 יום: ללא שינוי', () => {
    const r = stageProbability({ stage: 'submitted', lastActivityAt: '2026-09-01' }, ASOF)
    expect(r.daysStale).toBe(17)
    expect(r.probability).toBe(0.5)
  })

  it('30 יום: ההסתברות נחתכת לחצי', () => {
    const r = stageProbability({ stage: 'submitted', lastActivityAt: '2026-08-19' }, ASOF)
    expect(r.daysStale).toBe(30)
    expect(r.decayFactor).toBe(0.5)
    expect(r.probability).toBe(0.25)
  })

  it('60 יום: מתאפס ונוצרת משימה', () => {
    const r = stageProbability({ stage: 'execution', lastActivityAt: '2026-07-20' }, ASOF)
    expect(r.probability).toBe(0)
    expect(r.needsReviewTask).toBe(true)
  })

  it('הרקב גובר גם על דריסה ידנית', () => {
    const r = stageProbability(
      { stage: 'prospect', probabilityOverride: 0.9, lastActivityAt: '2026-06-01' },
      ASOF,
    )
    expect(r.probability).toBe(0)
    expect(r.baseProbability).toBe(0.9) // ההסבר למסך נשמר
  })

  it('בלי פעילות אחרונה אין רקב', () => {
    const r = stageProbability({ stage: 'submitted' }, ASOF)
    expect(r.daysStale).toBeNull()
    expect(r.probability).toBe(0.5)
  })
})
