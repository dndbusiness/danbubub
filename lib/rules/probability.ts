/**
 * הסתברות לפי שלב ורקב — SPEC §2.3.
 *
 * "פוטנציאלי 0% · חתם 30% · הוגש 50% · אישור עקרוני 70% · שמאות/עו"ד 85% ·
 *  ביצוע 95% · הושלם 100% (→ committed)."
 *
 * "רקב: אין פעילות 30 יום → ההסתברות נחתכת לחצי. 60 יום → 0 ומשימה
 *  'לעדכן/לסגור'."
 */

import { daysBetween, type IsoDate } from './period.js'
import type { DealStage } from './types.js'

/** ברירות מחדל — ניתנות לכיול במסך ההגדרות (SPEC §5 מסך 18). */
export const DEFAULT_STAGE_PROBABILITY: Record<DealStage, number> = {
  // מימון
  prospect: 0,
  signed_collecting_docs: 0.3,
  submitted: 0.5,
  approved_in_principle: 0.7,
  appraisal: 0.85,
  lawyer_signing: 0.85,
  execution: 0.95,
  completed: 1,
  // נדל"ן — מקבילה לאותה סקאלה
  re_lead: 0,
  re_meeting: 0.3,
  re_proposal: 0.5,
  re_contract_signed: 0.85,
  re_fee_paid: 0.95,
  re_developer_commission_received: 0.95,
  re_closed: 1,
}

export const STALE_HALVE_DAYS = 30
export const STALE_ZERO_DAYS = 60

export interface ProbabilityInput {
  stage: DealStage
  /** דריסה ידנית — גוברת על השלב, אך *לא* על הרקב. */
  probabilityOverride?: number
  lastActivityAt?: IsoDate
}

export interface ProbabilityResult {
  /** ההסתברות אחרי שלב, דריסה ורקב. */
  probability: number
  /** לפני הרקב — כדי שאפשר יהיה להסביר את הירידה במסך. */
  baseProbability: number
  /** 1 / 0.5 / 0 */
  decayFactor: number
  daysStale: number | null
  /** SPEC §2.3 — 60 יום → משימה "לעדכן/לסגור". */
  needsReviewTask: boolean
}

/**
 * @param asOf תאריך הייחוס. מועבר מפורשות ולא נלקח מ-`new Date()`,
 *             כדי שהפונקציה תישאר טהורה וניתנת לבדיקה.
 */
export function stageProbability(
  input: ProbabilityInput,
  asOf: IsoDate,
  overrides: Partial<Record<DealStage, number>> = {},
): ProbabilityResult {
  const base =
    input.probabilityOverride ??
    overrides[input.stage] ??
    DEFAULT_STAGE_PROBABILITY[input.stage] ??
    0

  const daysStale = input.lastActivityAt ? daysBetween(input.lastActivityAt, asOf) : null

  let decayFactor = 1
  if (daysStale !== null) {
    if (daysStale >= STALE_ZERO_DAYS) decayFactor = 0
    else if (daysStale >= STALE_HALVE_DAYS) decayFactor = 0.5
  }

  return {
    probability: clamp01(base * decayFactor),
    baseProbability: clamp01(base),
    decayFactor,
    daysStale,
    needsReviewTask: daysStale !== null && daysStale >= STALE_ZERO_DAYS,
  }
}

/** שלב "הושלם" הופך את הצפי ל-committed (SPEC §2.3). */
export function isCommittedStage(stage: DealStage): boolean {
  return DEFAULT_STAGE_PROBABILITY[stage] === 1
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1)
}
