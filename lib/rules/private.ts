/**
 * הכנסות פרייבט — SPEC §2.1, מסך 9.
 *
 * "נפרד לחלוטין מהחברה. אם הכסף נחת בטעות בחשבון החברה — נרשם כ-transfer
 * החוצה ומסומן." לכן אין כאן שום נגיעה ב-transactions, ב-division או ב-P&L:
 * הקלט הוא שורות `private_income` בלבד.
 *
 * חוקי הסף (`threshold_rule`) הם **שאלה פתוחה #7** — לכל קרן סף אחר, והם טרם
 * נמסרו. `evaluateThreshold` מכיר שתי צורות מפורשות ומחזיר `null` לכל צורה
 * אחרת, עם סיבה. המערכת לא מנחשת אחוז.
 */

import { allocateMoney, round2, sumBy, type Shekels } from './money.js'

export interface PrivateIncomeRow {
  id: string
  fundName: string
  dealRef?: string | null
  dealAmount?: Shekels | null
  pct?: number | null
  amountNet: Shekels
  vatAmount: Shekels
  splitDan: number
  splitNissim: number
  status: 'expected' | 'received'
  receivedDate?: string | null
}

export interface PrivateSplit {
  dan: Shekels
  nissim: Shekels
}

/**
 * חלוקת שורה בין דן לניסים. `allocateMoney` ולא כפל פשוט — כדי שאגורה
 * לא תיעלם כשהחלוקה לא מתחלקת (§11.5).
 */
export function splitPrivateRow(row: Pick<PrivateIncomeRow, 'amountNet' | 'splitDan' | 'splitNissim'>): PrivateSplit {
  const [dan, nissim] = allocateMoney(row.amountNet, [row.splitDan, row.splitNissim])
  return { dan: dan ?? 0, nissim: nissim ?? 0 }
}

export interface PrivateSummary {
  expected: { rows: number; amountNet: Shekels; dan: Shekels; nissim: Shekels }
  received: { rows: number; amountNet: Shekels; dan: Shekels; nissim: Shekels }
  total: { rows: number; amountNet: Shekels; dan: Shekels; nissim: Shekels }
  byFund: { fundName: string; rows: number; amountNet: Shekels; dan: Shekels; nissim: Shekels; expected: Shekels; received: Shekels }[]
}

/** מסך 9 — צפוי מול התקבל, ולכל אחד מהשניים בנפרד. */
export function summarizePrivateIncome(rows: readonly PrivateIncomeRow[]): PrivateSummary {
  const bucket = (subset: readonly PrivateIncomeRow[]) => ({
    rows: subset.length,
    amountNet: sumBy(subset, (r) => r.amountNet),
    dan: sumBy(subset, (r) => splitPrivateRow(r).dan),
    nissim: sumBy(subset, (r) => splitPrivateRow(r).nissim),
  })

  const expected = rows.filter((r) => r.status === 'expected')
  const received = rows.filter((r) => r.status === 'received')

  const funds = new Map<string, PrivateIncomeRow[]>()
  for (const r of rows) {
    const list = funds.get(r.fundName)
    if (list) list.push(r)
    else funds.set(r.fundName, [r])
  }

  return {
    expected: bucket(expected),
    received: bucket(received),
    total: bucket(rows),
    byFund: [...funds.entries()]
      .map(([fundName, list]) => ({
        fundName,
        ...bucket(list),
        expected: sumBy(list.filter((r) => r.status === 'expected'), (r) => r.amountNet),
        received: sumBy(list.filter((r) => r.status === 'received'), (r) => r.amountNet),
      }))
      .sort((a, b) => b.amountNet - a.amountNet),
  }
}

/**
 * חוקי סף — שתי הצורות היחידות שהמערכת מכירה (§2.1 נותן כדוגמה
 * "מעל 3M חודשי → 1%"):
 *
 *   { "type": "per_deal",       "min": 500000,  "pct": 0.01 }
 *   { "type": "monthly_volume", "min": 3000000, "pct": 0.01 }
 *
 * כל צורה אחרת מחזירה `null` עם סיבה — ולא ניחוש (שאלה #7).
 */
export type ThresholdRule =
  | { type: 'per_deal'; min: number; pct: number }
  | { type: 'monthly_volume'; min: number; pct: number }

export interface ThresholdResult {
  applies: boolean
  pct: number
  amount: Shekels
  explanation: string
}

export function evaluateThreshold(
  rule: unknown,
  ctx: { dealAmount: Shekels; monthlyVolume?: Shekels },
): ThresholdResult | null {
  if (!rule || typeof rule !== 'object') return null
  const r = rule as Partial<ThresholdRule>
  if (typeof r.pct !== 'number' || typeof r.min !== 'number') return null

  if (r.type === 'per_deal') {
    const applies = ctx.dealAmount >= r.min
    return {
      applies,
      pct: applies ? r.pct : 0,
      amount: applies ? round2(ctx.dealAmount * r.pct) : 0,
      explanation: applies
        ? `עסקה ${ctx.dealAmount.toLocaleString('he-IL')} ₪ ≥ סף ${r.min.toLocaleString('he-IL')} → ${(r.pct * 100).toFixed(2)}%`
        : `עסקה ${ctx.dealAmount.toLocaleString('he-IL')} ₪ מתחת לסף ${r.min.toLocaleString('he-IL')} — לא זכאי`,
    }
  }

  if (r.type === 'monthly_volume') {
    if (ctx.monthlyVolume === undefined) return null
    const applies = ctx.monthlyVolume >= r.min
    return {
      applies,
      pct: applies ? r.pct : 0,
      amount: applies ? round2(ctx.dealAmount * r.pct) : 0,
      explanation: applies
        ? `מחזור חודשי ${ctx.monthlyVolume.toLocaleString('he-IL')} ₪ ≥ ${r.min.toLocaleString('he-IL')} → ${(r.pct * 100).toFixed(2)}% על העסקה`
        : `מחזור חודשי ${ctx.monthlyVolume.toLocaleString('he-IL')} ₪ מתחת ל-${r.min.toLocaleString('he-IL')} — לא זכאי`,
    }
  }

  return null
}

/** הסבר לאדם כשאין כלל מוגדר — כדי שהמסך לא יציג "—" בלי סיבה. */
export const NO_THRESHOLD_RULE = 'לא הוגדר חוק סף לקרן הזו (שאלה פתוחה #7)'
