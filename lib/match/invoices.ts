/**
 * מנוע ההתאמה — SPEC §4.2 + ADDENDUM ב.3 שלב 5.
 *   דף בנק ↔ תנועה: סכום זהה ± 1 ₪, תאריך ± 3 ימים, אותו חשבון.
 *   חשבונית ↔ תנועה: ברוטו ± 1 ₪, תאריך ± 30 יום, ספק מנורמל.
 * תוצאה: התאמה מלאה / מועמדים / ללא התאמה. טהור.
 */
import { normalizeName } from '@/lib/intake/extract'

export interface MatchableTx { id: string; dateCash: string; amountGross: number; counterparty?: string | null; description?: string | null; accountId?: string; invoiceId?: string | null }
export interface MatchTarget { amountGross: number; date: string; supplierName?: string | null; supplierAliases?: string[]; accountId?: string }
export interface MatchOptions { amountTolerance?: number; dateDays?: number; requireSameAccount?: boolean }

export interface MatchCandidate { tx: MatchableTx; score: number; reasons: string[] }
export interface MatchResult { status: 'matched' | 'candidates' | 'none'; best: MatchCandidate | null; candidates: MatchCandidate[] }

const daysBetween = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000)

export function scoreMatch(target: MatchTarget, tx: MatchableTx, opts: MatchOptions = {}): MatchCandidate | null {
  const tol = opts.amountTolerance ?? 1
  const days = opts.dateDays ?? 30
  if (opts.requireSameAccount && target.accountId && tx.accountId && target.accountId !== tx.accountId) return null
  if (tx.invoiceId) return null // כבר משודך לחשבונית אחרת
  const amountDiff = Math.abs(Math.abs(tx.amountGross) - Math.abs(target.amountGross))
  if (amountDiff > tol) return null
  const dayDiff = daysBetween(tx.dateCash, target.date)
  if (dayDiff > days) return null
  const reasons: string[] = [amountDiff === 0 ? 'סכום זהה' : `סכום ±${amountDiff.toFixed(2)}`]
  let score = 0.5 + (amountDiff === 0 ? 0.2 : 0.1) + Math.max(0, 0.15 - dayDiff / days * 0.15)
  reasons.push(dayDiff === 0 ? 'אותו יום' : `${Math.round(dayDiff)} ימים הפרש`)
  const names = [target.supplierName, ...(target.supplierAliases ?? [])].filter((n): n is string => Boolean(n)).map(normalizeName).filter((n) => n.length >= 3)
  const hay = normalizeName(`${tx.counterparty ?? ''} ${tx.description ?? ''}`)
  if (names.length && names.some((n) => hay.includes(n))) { score += 0.15; reasons.push('ספק תואם') }
  return { tx, score: Math.min(1, Math.round(score * 100) / 100), reasons }
}

/** מלאה = ציון ≥ 0.7 ופער ברור (≥ 0.15) מהמועמד הבא. */
export function matchTarget(target: MatchTarget, txs: readonly MatchableTx[], opts: MatchOptions = {}): MatchResult {
  const candidates = txs.map((tx) => scoreMatch(target, tx, opts)).filter((c): c is MatchCandidate => c !== null).sort((a, b) => b.score - a.score)
  if (!candidates.length) return { status: 'none', best: null, candidates }
  const [best, second] = candidates
  const clear = best!.score >= 0.7 && (!second || best!.score - second.score >= 0.15)
  return { status: clear ? 'matched' : 'candidates', best: best!, candidates }
}

/** SPEC §4.2 — פרמטרים לדף בנק. */
export const BANK_MATCH: MatchOptions = { amountTolerance: 1, dateDays: 3, requireSameAccount: true }
/** ADDENDUM ב.3 — פרמטרים לחשבונית. */
export const INVOICE_MATCH: MatchOptions = { amountTolerance: 1, dateDays: 30 }
