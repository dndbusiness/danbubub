/**
 * מנוע כללים לומד — SPEC §4.4.
 *
 * "כל סיווג ידני מציע 'להפוך לכלל?'. כלל = תבנית טקסט (+ חשבון אופציונלי) →
 *  ערכי ברירת מחדל. אחרי חודשיים היעד: 90% מהתנועות מסווגות אוטומטית."
 *
 * טהור: מקבל תנועה גולמית ורשימת כללים, מחזיר הצעה. הכתיבה ל-DB (hit_count,
 * יצירת כלל) — בשכבה שמעל.
 */

export interface ClassificationRule {
  id: string
  /** תבנית על תיאור התנועה. טקסט = הכלה (case-insensitive), regex אם isRegex. */
  pattern: string
  isRegex: boolean
  /** כלל לחשבון מסוים בלבד (למשל כרטיס שניסים משתמש בו אישית). */
  accountId?: string | null
  setCategoryId?: string | null
  setDivision?: string | null
  setNature?: string | null
  setTxClass?: string | null
  setInvoiceStatus?: string | null
  setDeductible?: boolean | null
  /** נמוך = קודם. */
  priority: number
  active: boolean
}

export interface RawTx {
  description: string
  accountId?: string
  amount?: number
}

export interface Suggestion {
  ruleId: string
  categoryId?: string
  division?: string
  nature?: string
  txClass?: string
  invoiceStatus?: string
  deductible?: boolean
  /** מה גרם להתאמה — למסך האישור ("סווג לפי כלל: SUPER-PHARM → משרד"). */
  matchedPattern: string
  confidence: 'rule'
}

/** נרמול טקסט לתיאור: רווחים, גרשיים, אותיות. */
export function normalizeDescription(s: string): string {
  return s.replace(/[׳״'"“”]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function ruleMatches(rule: ClassificationRule, tx: RawTx): boolean {
  if (!rule.active) return false
  if (rule.accountId && tx.accountId && rule.accountId !== tx.accountId) return false
  const hay = normalizeDescription(tx.description)
  if (rule.isRegex) {
    try { return new RegExp(rule.pattern, 'i').test(tx.description) } catch { return false }
  }
  return hay.includes(normalizeDescription(rule.pattern))
}

/** הכלל הראשון שמתאים לפי עדיפות (ואז לפי ספציפיות: כלל עם חשבון גובר). */
export function classify(tx: RawTx, rules: readonly ClassificationRule[]): Suggestion | null {
  const matches = rules.filter((r) => ruleMatches(r, tx))
  if (!matches.length) return null
  matches.sort((a, b) => a.priority - b.priority || (b.accountId ? 1 : 0) - (a.accountId ? 1 : 0))
  const r = matches[0]!
  return {
    ruleId: r.id,
    categoryId: r.setCategoryId ?? undefined,
    division: r.setDivision ?? undefined,
    nature: r.setNature ?? undefined,
    txClass: r.setTxClass ?? undefined,
    invoiceStatus: r.setInvoiceStatus ?? undefined,
    deductible: r.setDeductible ?? undefined,
    matchedPattern: r.pattern,
    confidence: 'rule',
  }
}

/** סיווג אצווה + מדד האוטומציה (יעד §4.4: 80% אחרי חודש, 90% אחרי חודשיים). */
export function classifyBatch(txs: readonly RawTx[], rules: readonly ClassificationRule[]) {
  const results = txs.map((tx) => ({ tx, suggestion: classify(tx, rules) }))
  const auto = results.filter((r) => r.suggestion !== null).length
  return { results, autoRate: txs.length ? auto / txs.length : 0, auto, total: txs.length }
}

/**
 * "להפוך לכלל?" — מציע כלל מתוך סיווג ידני.
 * התבנית: שם בית העסק בלי מספרים/תאריכים (כדי ש-"SUPER PHARM 1234" יתפוס
 * גם "SUPER PHARM 5678").
 */
export function proposeRule(
  tx: RawTx,
  chosen: { categoryId?: string; division?: string; nature?: string; txClass?: string; invoiceStatus?: string; deductible?: boolean },
  opts: { scopeToAccount?: boolean } = {},
): Omit<ClassificationRule, 'id' | 'active'> {
  const pattern = tx.description
    .replace(/\d[\d./-]*/g, ' ')          // מספרי עסקה, תאריכים, סניפים
    .replace(/[*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    pattern: pattern || tx.description.trim(),
    isRegex: false,
    accountId: opts.scopeToAccount ? tx.accountId ?? null : null,
    setCategoryId: chosen.categoryId ?? null,
    setDivision: chosen.division ?? null,
    setNature: chosen.nature ?? null,
    setTxClass: chosen.txClass ?? null,
    setInvoiceStatus: chosen.invoiceStatus ?? null,
    setDeductible: chosen.deductible ?? null,
    priority: 100,
  }
}

/** כללים שסותרים: אותה תבנית ואותו חשבון עם ערכים שונים — למניעת "הכלל האחרון מנצח" בשקט. */
export function findConflicts(rules: readonly ClassificationRule[]): Array<[ClassificationRule, ClassificationRule]> {
  const out: Array<[ClassificationRule, ClassificationRule]> = []
  for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
    const a = rules[i]!, b = rules[j]!
    if (!a.active || !b.active) continue
    if (normalizeDescription(a.pattern) !== normalizeDescription(b.pattern)) continue
    if ((a.accountId ?? null) !== (b.accountId ?? null)) continue
    if (a.setCategoryId !== b.setCategoryId || a.setDivision !== b.setDivision || a.setNature !== b.setNature) out.push([a, b])
  }
  return out
}
