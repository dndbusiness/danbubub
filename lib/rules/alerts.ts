/**
 * מנוע התראות — ADDENDUM ב.11.
 *
 * "התראה = משהו שדורש החלטה, לא רעש."
 *
 * כל התראה נושאת `ruleKey` ייחודי (ADDENDUM הנחיה 18: "מניעת כפילויות היא
 * חובה, לא שיפור") — אותה בעיה לא מייצרת שתי התראות ולא שתי משימות.
 *
 * הפונקציות כאן טהורות: הן מקבלות מצב ומחזירות רשימת התראות. ההחלטה מה
 * לשלוח, למי ובאיזה ערוץ שייכת לשכבת ה-outbox (ADDENDUM הנחיה 16).
 */

import { absMoney, round2, type Shekels } from './money.js'
import { addDays, daysBetween, type IsoDate } from './period.js'

export type AlertSeverity = 'critical' | 'high' | 'info'

export type AlertChannel = 'whatsapp' | 'email' | 'screen' | 'daily_summary' | 'weekly_report'

export type AlertKind =
  | 'negative_balance_forecast'
  | 'outflow_exceeds_committed_inflow'
  | 'daily_close_variance'
  | 'anchor_stale'
  | 'fixed_expense_missing'
  | 'fixed_expense_amount_deviation'
  | 'card_charge_exceeds_credit'
  | 'budget_overrun'
  | 'missing_invoices_vat'
  | 'income_without_invoice'
  | 'invoice_issued_unpaid'
  | 'nissim_balance_exceeds_threshold'
  | 'advances_exceed_expected_share'
  | 'realestate_draws_uneven'
  | 'deal_decay'
  | 'integration_disconnected'
  | 'scheduled_job_failed'

export interface Alert {
  kind: AlertKind
  /** מפתח ייחודי לבעיה — מונע כפילויות. */
  ruleKey: string
  severity: AlertSeverity
  channels: AlertChannel[]
  title: string
  detail?: string
  amount?: Shekels
  date?: IsoDate
  refIds?: string[]
}

/** ADDENDUM ב.11 — ברירות המחדל לכל כלל. ניתנות לשינוי במסך ההגדרות. */
export const ALERT_DEFAULTS: Record<
  AlertKind,
  { severity: AlertSeverity; channels: AlertChannel[] }
> = {
  negative_balance_forecast: { severity: 'critical', channels: ['whatsapp', 'email'] },
  outflow_exceeds_committed_inflow: { severity: 'high', channels: ['whatsapp'] },
  daily_close_variance: { severity: 'high', channels: ['screen', 'daily_summary'] },
  anchor_stale: { severity: 'high', channels: ['whatsapp'] },
  fixed_expense_missing: { severity: 'high', channels: ['daily_summary'] },
  fixed_expense_amount_deviation: { severity: 'high', channels: ['daily_summary'] },
  card_charge_exceeds_credit: { severity: 'critical', channels: ['whatsapp'] },
  budget_overrun: { severity: 'info', channels: ['weekly_report'] },
  missing_invoices_vat: { severity: 'high', channels: ['weekly_report'] },
  income_without_invoice: { severity: 'high', channels: ['daily_summary'] },
  invoice_issued_unpaid: { severity: 'high', channels: ['weekly_report'] },
  nissim_balance_exceeds_threshold: { severity: 'high', channels: ['email'] },
  advances_exceed_expected_share: { severity: 'info', channels: ['screen'] },
  realestate_draws_uneven: { severity: 'info', channels: ['screen'] },
  deal_decay: { severity: 'info', channels: ['screen'] },
  integration_disconnected: { severity: 'critical', channels: ['whatsapp', 'email', 'screen'] },
  scheduled_job_failed: { severity: 'high', channels: ['email'] },
}

/** ADDENDUM ב.11 — ספי ברירת המחדל. שאלה פתוחה #22: המספרים טעונים אישור. */
export interface AlertThresholds {
  /** סטיית סגירת יום. */
  dailyVarianceShekels: Shekels
  /** שעות ללא עדכון עוגן. */
  anchorStaleHours: number
  /** ימים אחרי היום הצפוי שהוצאה קבועה לא ירדה. */
  fixedExpenseLateDays: number
  /** סטייה בסכום הוצאה קבועה. */
  fixedExpenseDeviationPct: number
  /** Σ מע"מ מפוספס. */
  missingVatShekels: Shekels
  /** ימים מהכנסה ועד חשבונית. */
  incomeWithoutInvoiceDays: number
  /** חוב ניסים מצטבר. */
  nissimBalanceShekels: Shekels
  /** סטיית משיכות נדל"ן YTD. */
  realestateDrawVariancePct: number
  /** מעל כמה התראות קריטיות פעילות → "תזרים במצב סיכון". */
  riskModeCriticalCount: number
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  dailyVarianceShekels: 1_500,
  anchorStaleHours: 48,
  fixedExpenseLateDays: 5,
  fixedExpenseDeviationPct: 0.2,
  missingVatShekels: 1_000,
  incomeWithoutInvoiceDays: 7,
  nissimBalanceShekels: 50_000,
  realestateDrawVariancePct: 0.1,
  riskModeCriticalCount: 5,
}

function make(
  kind: AlertKind,
  ruleKey: string,
  title: string,
  extra: Partial<Alert> = {},
): Alert {
  const defaults = ALERT_DEFAULTS[kind]
  return {
    kind,
    ruleKey,
    severity: defaults.severity,
    channels: defaults.channels,
    title,
    ...extra,
  }
}

// ── קלט להערכה ─────────────────────────────────────────────────────────────

export interface AlertEvaluationInput {
  asOf: IsoDate
  thresholds?: Partial<AlertThresholds>

  /** מהתזרים (§3.6): השבוע הראשון שבו היתרה שלילית. */
  firstNegativeWeek?: IsoDate | null
  lowPointBalance?: Shekels

  /** Σ יוצא ודאי 30 יום, ו-Σ נכנס committed 30 יום. */
  committedOutflow30d?: Shekels
  committedInflow30d?: Shekels
  currentBalance?: Shekels

  /** סגירת יום (§3.6). */
  dailyVariance?: Shekels

  /** תאריך העוגן האחרון. */
  lastAnchorDate?: IsoDate

  /** הוצאות קבועות שלא ירדו או שירדו בסכום חריג. */
  fixedExpenseStatus?: readonly {
    fixedExpenseId: string
    name: string
    expectedDate: IsoDate
    expectedAmount: Shekels
    actualAmount?: Shekels
  }[]

  /** חיוב אשראי צפוי מול מסגרת פנויה. */
  cardCharges?: readonly {
    accountId: string
    accountName: string
    billingDate: IsoDate
    expectedCharge: Shekels
    availableCredit: Shekels
  }[]

  /** מע"מ תשומות שחסרה לו חשבונית (§3.1). */
  missingInputVat?: Shekels
  missingInvoiceCount?: number

  /** הכנסות ללא חשבונית. */
  incomeWithoutInvoice?: readonly { txId: string; date: IsoDate; amount: Shekels }[]

  /** חשבוניות שהוצאו ולא שולמו. */
  invoicesUnpaid?: readonly { invoiceId: string; date: IsoDate; amount: Shekels }[]

  /** יתרת ניסים (§3.3 שורה 7). */
  nissimBalance?: Shekels
  /** מקדמות החודש מול חלק צפוי. */
  advancesThisMonth?: Shekels
  expectedNissimShareMtd?: Shekels

  /** סטיית משיכות נדל"ן (§3.5). */
  realestateDrawVariance?: readonly { partnerId: string; name: string; variance: Shekels; target: Shekels }[]

  /** תיקים שנרקבו (§2.3). */
  decayedDeals?: readonly { dealId: string; clientName: string; daysStale: number; ownerUserId?: string }[]

  /** אינטגרציות מנותקות. */
  disconnectedIntegrations?: readonly string[]

  /** ג'ובים מתוזמנים שנכשלו (חלק ג). */
  failedJobs?: readonly { jobName: string; failedAt: IsoDate; error?: string }[]

  /** חריגות תקציב. */
  budgetOverruns?: readonly { categoryId: string; categoryName: string; spent: Shekels; budget: Shekels }[]
}

/**
 * מריץ את כל 16 הכללים של ב.11 ומחזיר את ההתראות הפעילות.
 * ההערכה דטרמיניסטית: אותו קלט → אותן התראות, אותם `ruleKey`.
 */
export function evaluateAlerts(input: AlertEvaluationInput): Alert[] {
  const t = { ...DEFAULT_THRESHOLDS, ...input.thresholds }
  const alerts: Alert[] = []
  const { asOf } = input

  // 1. יתרה צפויה שלילית
  if (input.firstNegativeWeek) {
    alerts.push(
      make(
        'negative_balance_forecast',
        `negative_balance:${input.firstNegativeWeek}`,
        `יתרה צפויה שלילית ב-${input.firstNegativeWeek}`,
        {
          date: input.firstNegativeWeek,
          amount: input.lowPointBalance !== undefined ? round2(input.lowPointBalance) : undefined,
          detail:
            input.lowPointBalance !== undefined
              ? `נקודה נמוכה: ${round2(input.lowPointBalance)} ₪`
              : undefined,
        },
      ),
    )
  }

  // 2. הוצאות ודאיות > יתרה + תקבולים ודאיים
  if (
    input.committedOutflow30d !== undefined &&
    input.committedInflow30d !== undefined &&
    input.currentBalance !== undefined
  ) {
    const available = input.currentBalance + input.committedInflow30d
    if (input.committedOutflow30d > available) {
      alerts.push(
        make(
          'outflow_exceeds_committed_inflow',
          `outflow_exceeds:${asOf.slice(0, 7)}`,
          'חריגה צפויה — הוצאות ודאיות עולות על הכסף הזמין ב-30 יום',
          {
            amount: round2(input.committedOutflow30d - available),
            detail: `יוצא ${round2(input.committedOutflow30d)} ₪ מול ${round2(available)} ₪ זמינים`,
          },
        ),
      )
    }
  }

  // 3. סטיית סגירת יום
  if (input.dailyVariance !== undefined && Math.abs(input.dailyVariance) > t.dailyVarianceShekels) {
    alerts.push(
      make('daily_close_variance', `daily_variance:${asOf}`, `סטיית סגירת יום ${round2(input.dailyVariance)} ₪`, {
        amount: round2(input.dailyVariance),
        date: asOf,
      }),
    )
  }

  // 4. עוגן לא עודכן
  if (input.lastAnchorDate) {
    const staleDays = daysBetween(input.lastAnchorDate, asOf)
    if (staleDays * 24 >= t.anchorStaleHours) {
      alerts.push(
        make('anchor_stale', `anchor_stale:${asOf}`, `העוגן לא עודכן ${staleDays} ימים`, {
          date: input.lastAnchorDate,
        }),
      )
    }
  }

  // 5+6. הוצאה קבועה שלא ירדה / בסכום חריג
  for (const fx of input.fixedExpenseStatus ?? []) {
    if (fx.actualAmount === undefined) {
      const lateDays = daysBetween(fx.expectedDate, asOf)
      if (lateDays >= t.fixedExpenseLateDays) {
        alerts.push(
          make(
            'fixed_expense_missing',
            `fixed_missing:${fx.fixedExpenseId}:${fx.expectedDate.slice(0, 7)}`,
            `"${fx.name}" לא ירדה — ${lateDays} ימים אחרי הצפוי`,
            { amount: fx.expectedAmount, date: fx.expectedDate },
          ),
        )
      }
      continue
    }
    const expected = Math.abs(fx.expectedAmount)
    const actual = Math.abs(fx.actualAmount)
    if (expected > 0 && Math.abs(actual - expected) / expected > t.fixedExpenseDeviationPct) {
      alerts.push(
        make(
          'fixed_expense_amount_deviation',
          `fixed_deviation:${fx.fixedExpenseId}:${fx.expectedDate.slice(0, 7)}`,
          `"${fx.name}" ירדה ב-${round2(actual)} ₪ במקום ${round2(expected)} ₪`,
          { amount: round2(actual - expected), date: fx.expectedDate },
        ),
      )
    }
  }

  // 7. חיוב אשראי > מסגרת פנויה
  for (const card of input.cardCharges ?? []) {
    if (card.expectedCharge > card.availableCredit) {
      alerts.push(
        make(
          'card_charge_exceeds_credit',
          `card_over_limit:${card.accountId}:${card.billingDate}`,
          `חיוב צפוי ב"${card.accountName}" עולה על המסגרת הפנויה`,
          {
            amount: round2(card.expectedCharge - card.availableCredit),
            date: card.billingDate,
            detail: `חיוב ${round2(card.expectedCharge)} ₪ מול ${round2(card.availableCredit)} ₪ פנויים`,
          },
        ),
      )
    }
  }

  // 8. חריגת תקציב
  for (const b of input.budgetOverruns ?? []) {
    if (b.budget > 0 && b.spent > b.budget) {
      alerts.push(
        make(
          'budget_overrun',
          `budget:${b.categoryId}:${asOf.slice(0, 7)}`,
          `חריגת תקציב ב"${b.categoryName}"`,
          { amount: round2(b.spent - b.budget) },
        ),
      )
    }
  }

  // 9. חשבוניות חסרות — מע"מ מפוספס
  if ((input.missingInputVat ?? 0) > t.missingVatShekels) {
    alerts.push(
      make(
        'missing_invoices_vat',
        `missing_vat:${asOf.slice(0, 7)}`,
        `${round2(input.missingInputVat!)} ₪ מע"מ תשומות ללא חשבונית`,
        {
          amount: round2(input.missingInputVat!),
          detail: `${input.missingInvoiceCount ?? 0} הוצאות`,
        },
      ),
    )
  }

  // 10. הכנסה ללא חשבונית
  for (const inc of input.incomeWithoutInvoice ?? []) {
    const days = daysBetween(inc.date, asOf)
    if (days >= t.incomeWithoutInvoiceDays) {
      alerts.push(
        make(
          'income_without_invoice',
          `income_no_invoice:${inc.txId}`,
          `הכנסה ${absMoney(inc.amount)} ₪ מ-${inc.date} ללא חשבונית (${days} ימים)`,
          { amount: absMoney(inc.amount), date: inc.date, refIds: [inc.txId] },
        ),
      )
    }
  }

  // 11. חשבונית שהוצאה ולא שולמה
  for (const inv of input.invoicesUnpaid ?? []) {
    const days = daysBetween(inv.date, asOf)
    if (days >= 30) {
      alerts.push(
        make(
          'invoice_issued_unpaid',
          `invoice_unpaid:${inv.invoiceId}`,
          `חשבונית מ-${inv.date} לא שולמה ${days} יום`,
          { amount: inv.amount, date: inv.date, refIds: [inv.invoiceId] },
        ),
      )
    }
  }

  // 12. יתרת ניסים חורגת
  if (input.nissimBalance !== undefined && Math.abs(input.nissimBalance) > t.nissimBalanceShekels) {
    alerts.push(
      make(
        'nissim_balance_exceeds_threshold',
        `nissim_balance:${asOf.slice(0, 7)}`,
        `יתרת ההתחשבנות עם ניסים ${round2(input.nissimBalance)} ₪ — מעל הסף`,
        { amount: round2(input.nissimBalance) },
      ),
    )
  }

  // 13. מקדמות > חלק צפוי
  if (
    input.advancesThisMonth !== undefined &&
    input.expectedNissimShareMtd !== undefined &&
    input.expectedNissimShareMtd > 0 &&
    input.advancesThisMonth > input.expectedNissimShareMtd * 1.5
  ) {
    alerts.push(
      make(
        'advances_exceed_expected_share',
        `advances_exceed:${asOf.slice(0, 7)}`,
        'המקדמות החודש עולות על חלקו הצפוי של ניסים',
        {
          amount: round2(input.advancesThisMonth - input.expectedNissimShareMtd),
          detail: `מקדמות ${round2(input.advancesThisMonth)} ₪ מול חלק צפוי ${round2(input.expectedNissimShareMtd)} ₪`,
        },
      ),
    )
  }

  // 14. משיכות נדל"ן לא שוויוניות
  for (const p of input.realestateDrawVariance ?? []) {
    if (p.target > 0 && Math.abs(p.variance) / p.target > t.realestateDrawVariancePct) {
      alerts.push(
        make(
          'realestate_draws_uneven',
          `re_draw_variance:${p.partnerId}:${asOf.slice(0, 4)}`,
          `${p.name}: סטייה ${round2(p.variance)} ₪ מהיעד השוויוני`,
          { amount: round2(p.variance) },
        ),
      )
    }
  }

  // 15. תיק נרקב
  for (const d of input.decayedDeals ?? []) {
    alerts.push(
      make('deal_decay', `deal_decay:${d.dealId}:${d.daysStale >= 60 ? 60 : 30}`, `תיק "${d.clientName}" ללא פעילות ${d.daysStale} יום`, {
        refIds: [d.dealId],
        detail: d.daysStale >= 60 ? 'לעדכן או לסגור' : 'ההסתברות נחתכה לחצי',
      }),
    )
  }

  // 16. אינטגרציה מנותקת
  for (const name of input.disconnectedIntegrations ?? []) {
    alerts.push(
      make('integration_disconnected', `integration:${name}`, `${name} מנותק — נדרש חיבור מחדש`),
    )
  }

  // 17. ג'וב מתוזמן נכשל
  for (const job of input.failedJobs ?? []) {
    alerts.push(
      make('scheduled_job_failed', `job_failed:${job.jobName}:${job.failedAt.slice(0, 10)}`, `הג'וב "${job.jobName}" נכשל`, {
        date: job.failedAt,
        detail: job.error,
      }),
    )
  }

  return alerts
}

/**
 * ADDENDUM ב.11 — "יותר מ-5 התראות קריטיות פעילות בו-זמנית → המערכת מציגה
 * 'תזרים במצב סיכון' בראש כל מסך."
 */
export function isRiskMode(
  alerts: readonly Alert[],
  thresholds: Partial<AlertThresholds> = {},
): boolean {
  const limit = thresholds.riskModeCriticalCount ?? DEFAULT_THRESHOLDS.riskModeCriticalCount
  return alerts.filter((a) => a.severity === 'critical').length > limit
}

/**
 * מיזוג עם התראות שכבר קיימות: התראה עם אותו `ruleKey` אינה נוצרת פעמיים,
 * והתראה שהתנאי שלה חדל להתקיים מסומנת לסגירה.
 * ADDENDUM ב.10: "משימה אוטומטית נסגרת לבד כשהתנאי מפסיק להתקיים."
 */
export interface AlertReconciliation {
  toCreate: Alert[]
  toResolve: string[]
  unchanged: string[]
}

export function reconcileAlerts(
  current: readonly Alert[],
  existing: readonly { ruleKey: string; snoozedUntil?: IsoDate }[],
): AlertReconciliation {
  const currentKeys = new Set(current.map((a) => a.ruleKey))
  const existingByKey = new Map(existing.map((e) => [e.ruleKey, e]))

  // התראה שכבר קיימת אינה נוצרת שוב — זו כל מטרת ה-ruleKey.
  // ההשהיה משפיעה על *המסירה* (isSnoozed), לא על הקיום.
  const toCreate = current.filter((a) => !existingByKey.has(a.ruleKey))

  return {
    toCreate,
    toResolve: existing.filter((e) => !currentKeys.has(e.ruleKey)).map((e) => e.ruleKey),
    unchanged: existing.filter((e) => currentKeys.has(e.ruleKey)).map((e) => e.ruleKey),
  }
}

/** האם התראה מושהית כרגע. */
export function isSnoozed(
  alert: { snoozedUntil?: IsoDate },
  asOf: IsoDate,
): boolean {
  return alert.snoozedUntil !== undefined && alert.snoozedUntil > asOf
}

/** תאריך סיום השהיה. */
export function snoozeUntil(asOf: IsoDate, days: number): IsoDate {
  return addDays(asOf, days)
}
