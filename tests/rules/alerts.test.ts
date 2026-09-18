import { describe, expect, it } from 'vitest'
import {
  ALERT_DEFAULTS,
  DEFAULT_THRESHOLDS,
  evaluateAlerts,
  isRiskMode,
  isSnoozed,
  reconcileAlerts,
  snoozeUntil,
  type Alert,
} from '@/lib/rules/alerts.js'

const ASOF = '2026-09-18'

const kindsOf = (alerts: Alert[]) => alerts.map((a) => a.kind)

describe('מנוע התראות — ADDENDUM ב.11', () => {
  it('מצב נקי לא מייצר רעש', () => {
    expect(evaluateAlerts({ asOf: ASOF })).toEqual([])
  })

  it('יתרה צפויה שלילית — קריטי, וואטסאפ + מייל', () => {
    const [alert] = evaluateAlerts({
      asOf: ASOF, firstNegativeWeek: '2026-11-08', lowPointBalance: -12_000,
    })
    expect(alert!.kind).toBe('negative_balance_forecast')
    expect(alert!.severity).toBe('critical')
    expect(alert!.channels).toEqual(['whatsapp', 'email'])
    expect(alert!.date).toBe('2026-11-08')
  })

  it('הוצאות ודאיות מעל הכסף הזמין', () => {
    const alerts = evaluateAlerts({
      asOf: ASOF, currentBalance: 50_000, committedInflow30d: 30_000, committedOutflow30d: 120_000,
    })
    const a = alerts.find((x) => x.kind === 'outflow_exceeds_committed_inflow')!
    expect(a.amount).toBe(40_000)
  })

  it('הוצאות ודאיות מתחת לזמין — אין התראה', () => {
    expect(evaluateAlerts({
      asOf: ASOF, currentBalance: 100_000, committedInflow30d: 30_000, committedOutflow30d: 120_000,
    })).toEqual([])
  })

  it('סטיית סגירת יום מעל הסף בלבד', () => {
    expect(kindsOf(evaluateAlerts({ asOf: ASOF, dailyVariance: -2_500 })))
      .toContain('daily_close_variance')
    expect(evaluateAlerts({ asOf: ASOF, dailyVariance: -900 })).toEqual([])
  })

  it('עוגן לא עודכן 48 שעות', () => {
    expect(kindsOf(evaluateAlerts({ asOf: ASOF, lastAnchorDate: '2026-09-16' })))
      .toContain('anchor_stale')
    expect(evaluateAlerts({ asOf: ASOF, lastAnchorDate: '2026-09-17' })).toEqual([])
  })

  it('הוצאה קבועה שלא ירדה 5 ימים אחרי הצפוי', () => {
    const alerts = evaluateAlerts({
      asOf: ASOF,
      fixedExpenseStatus: [
        { fixedExpenseId: 'fx1', name: 'שכירות', expectedDate: '2026-09-01', expectedAmount: 8_000 },
        { fixedExpenseId: 'fx2', name: 'רו"ח', expectedDate: '2026-09-15', expectedAmount: 3_000 },
      ],
    })
    const missing = alerts.filter((a) => a.kind === 'fixed_expense_missing')
    expect(missing).toHaveLength(1)
    expect(missing[0]!.title).toContain('שכירות')
  })

  it('הוצאה קבועה בסכום חריג ±20%', () => {
    const alerts = evaluateAlerts({
      asOf: ASOF,
      fixedExpenseStatus: [
        { fixedExpenseId: 'fx1', name: 'תוכנה', expectedDate: '2026-09-05', expectedAmount: 5_000, actualAmount: 6_500 },
        { fixedExpenseId: 'fx2', name: 'שכירות', expectedDate: '2026-09-01', expectedAmount: 8_000, actualAmount: 8_400 },
      ],
    })
    const dev = alerts.filter((a) => a.kind === 'fixed_expense_amount_deviation')
    expect(dev).toHaveLength(1)
    expect(dev[0]!.title).toContain('תוכנה')
  })

  it('חיוב אשראי מעל המסגרת — קריטי', () => {
    const a = evaluateAlerts({
      asOf: ASOF,
      cardCharges: [{ accountId: 'c1', accountName: 'ויזה כאל', billingDate: '2026-10-02', expectedCharge: 42_000, availableCredit: 30_000 }],
    })[0]!
    expect(a.kind).toBe('card_charge_exceeds_credit')
    expect(a.severity).toBe('critical')
    expect(a.amount).toBe(12_000)
  })

  it('מע"מ מפוספס מעל הסף', () => {
    expect(kindsOf(evaluateAlerts({ asOf: ASOF, missingInputVat: 1_800, missingInvoiceCount: 7 })))
      .toContain('missing_invoices_vat')
    expect(evaluateAlerts({ asOf: ASOF, missingInputVat: 400 })).toEqual([])
  })

  it('הכנסה ללא חשבונית 7 ימים', () => {
    const alerts = evaluateAlerts({
      asOf: ASOF,
      incomeWithoutInvoice: [
        { txId: 't1', date: '2026-09-01', amount: 20_000 },
        { txId: 't2', date: '2026-09-16', amount: 5_000 },
      ],
    })
    expect(alerts.filter((a) => a.kind === 'income_without_invoice')).toHaveLength(1)
  })

  it('יתרת ניסים חורגת מהסף', () => {
    expect(kindsOf(evaluateAlerts({ asOf: ASOF, nissimBalance: 62_000 })))
      .toContain('nissim_balance_exceeds_threshold')
    expect(evaluateAlerts({ asOf: ASOF, nissimBalance: 36_517 })).toEqual([])
  })

  it('יתרה שלילית גדולה גם היא חריגה (החברה חייבת)', () => {
    expect(kindsOf(evaluateAlerts({ asOf: ASOF, nissimBalance: -80_000 })))
      .toContain('nissim_balance_exceeds_threshold')
  })

  it('מקדמות מעל 1.5× חלקו הצפוי', () => {
    expect(kindsOf(evaluateAlerts({
      asOf: ASOF, advancesThisMonth: 19_000, expectedNissimShareMtd: 10_000,
    }))).toContain('advances_exceed_expected_share')
    expect(evaluateAlerts({
      asOf: ASOF, advancesThisMonth: 19_000, expectedNissimShareMtd: 20_000,
    })).toEqual([])
  })

  it('משיכות נדל"ן בסטייה מעל 10%', () => {
    const alerts = evaluateAlerts({
      asOf: ASOF,
      realestateDrawVariance: [
        { partnerId: 'dan', name: 'דן', variance: -25_000, target: 83_333 },
        { partnerId: 'aviv', name: 'אביב', variance: 2_000, target: 83_333 },
      ],
    })
    expect(alerts.filter((a) => a.kind === 'realestate_draws_uneven')).toHaveLength(1)
  })

  it('תיק נרקב — 30 ו-60 יום הם התראות נפרדות', () => {
    const at30 = evaluateAlerts({
      asOf: ASOF, decayedDeals: [{ dealId: 'd1', clientName: 'כהן', daysStale: 35 }],
    })[0]!
    const at60 = evaluateAlerts({
      asOf: ASOF, decayedDeals: [{ dealId: 'd1', clientName: 'כהן', daysStale: 65 }],
    })[0]!
    expect(at30.ruleKey).not.toBe(at60.ruleKey)
    expect(at60.detail).toBe('לעדכן או לסגור')
  })

  it('אינטגרציה מנותקת וג\'וב שנכשל', () => {
    const alerts = evaluateAlerts({
      asOf: ASOF,
      disconnectedIntegrations: ['Google'],
      failedJobs: [{ jobName: 'gmail_scan', failedAt: '2026-09-18', error: 'invalid_grant' }],
    })
    expect(kindsOf(alerts)).toEqual(
      expect.arrayContaining(['integration_disconnected', 'scheduled_job_failed']),
    )
    expect(alerts.find((a) => a.kind === 'integration_disconnected')!.severity).toBe('critical')
  })

  it('ספים ניתנים לדריסה מההגדרות', () => {
    expect(evaluateAlerts({ asOf: ASOF, dailyVariance: -900 })).toEqual([])
    expect(evaluateAlerts({
      asOf: ASOF, dailyVariance: -900, thresholds: { dailyVarianceShekels: 500 },
    })).toHaveLength(1)
  })

  it('לכל 17 סוגי ההתראות יש ברירת מחדל', () => {
    for (const [kind, d] of Object.entries(ALERT_DEFAULTS)) {
      expect(d.channels.length, kind).toBeGreaterThan(0)
      expect(['critical', 'high', 'info']).toContain(d.severity)
    }
  })
})

describe('מצב סיכון — ADDENDUM ב.11', () => {
  const critical = (i: number): Alert => ({
    kind: 'negative_balance_forecast', ruleKey: `k${i}`, severity: 'critical',
    channels: ['email'], title: `t${i}`,
  })

  it('יותר מ-5 קריטיות → "תזרים במצב סיכון"', () => {
    expect(isRiskMode(Array.from({ length: 6 }, (_, i) => critical(i)))).toBe(true)
    expect(isRiskMode(Array.from({ length: 5 }, (_, i) => critical(i)))).toBe(false)
  })

  it('התראות מידע לא מפעילות מצב סיכון', () => {
    const info: Alert[] = Array.from({ length: 20 }, (_, i) => ({
      ...critical(i), severity: 'info' as const,
    }))
    expect(isRiskMode(info)).toBe(false)
  })

  it('הסף ניתן להגדרה', () => {
    expect(isRiskMode([critical(1), critical(2)], { riskModeCriticalCount: 1 })).toBe(true)
  })
})

describe('מניעת כפילויות — ADDENDUM הנחיה 18', () => {
  const alerts = evaluateAlerts({ asOf: ASOF, firstNegativeWeek: '2026-11-08' })

  it('אותה בעיה לא נוצרת פעמיים', () => {
    const r = reconcileAlerts(alerts, [{ ruleKey: alerts[0]!.ruleKey }])
    expect(r.toCreate).toHaveLength(0)
    expect(r.unchanged).toEqual([alerts[0]!.ruleKey])
  })

  it('התראה חדשה נוצרת', () => {
    expect(reconcileAlerts(alerts, []).toCreate).toHaveLength(1)
  })

  it('התראה שהתנאי שלה חדל להתקיים נסגרת לבד', () => {
    const r = reconcileAlerts([], [{ ruleKey: 'anchor_stale:2026-09-10' }])
    expect(r.toResolve).toEqual(['anchor_stale:2026-09-10'])
  })

  it('ריצה חוזרת על אותו מצב יציבה', () => {
    const a = evaluateAlerts({ asOf: ASOF, firstNegativeWeek: '2026-11-08', nissimBalance: 62_000 })
    const b = evaluateAlerts({ asOf: ASOF, firstNegativeWeek: '2026-11-08', nissimBalance: 62_000 })
    expect(a.map((x) => x.ruleKey)).toEqual(b.map((x) => x.ruleKey))
  })

  it('השהיה', () => {
    const until = snoozeUntil(ASOF, 3)
    expect(until).toBe('2026-09-21')
    expect(isSnoozed({ snoozedUntil: until }, ASOF)).toBe(true)
    expect(isSnoozed({ snoozedUntil: until }, '2026-09-22')).toBe(false)
    expect(isSnoozed({}, ASOF)).toBe(false)
  })
})

describe('ספי ברירת מחדל — שאלה פתוחה #22', () => {
  it('הערכים הראשוניים מתועדים', () => {
    expect(DEFAULT_THRESHOLDS.dailyVarianceShekels).toBe(1_500)
    expect(DEFAULT_THRESHOLDS.nissimBalanceShekels).toBe(50_000)
    expect(DEFAULT_THRESHOLDS.missingVatShekels).toBe(1_000)
    expect(DEFAULT_THRESHOLDS.riskModeCriticalCount).toBe(5)
  })
})
