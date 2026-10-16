import { describe, expect, it } from 'vitest'
import { computeWeeklyConversion, flagChannels } from '@/lib/rules/conversion.js'
import type { Deal, Lead, LeadCost, Transaction } from '@/lib/rules/types.js'

const WEEK = '2026-09-13' // ראשון

function lead(id: string, stage: Lead['stage'], sourceId: string, dealId?: string): Lead {
  return { id, date: '2026-09-15', sourceId, product: 'business_credit', stage, dealId }
}

const leads: Lead[] = [
  lead('l1', 'closed_won', 'avinoam', 'd1'),
  lead('l2', 'signed', 'avinoam', 'd2'),
  lead('l3', 'meeting', 'avinoam'),
  lead('l4', 'received', 'avinoam'),
  lead('l5', 'contacted', 'alex'),
  lead('l6', 'received', 'alex'),
]

const deals: Deal[] = [
  { id: 'd1', clientName: 'א', division: 'finance', product: 'business_credit', stage: 'completed', collectionStatus: 'fully_paid', feeAgreedNet: 30_000, feeMode: 'fixed', status: 'won' },
  { id: 'd2', clientName: 'ב', division: 'finance', product: 'business_credit', stage: 'execution', collectionStatus: 'not_collected', feeAgreedNet: 20_000, feeMode: 'fixed', status: 'open' },
]

const txs: Transaction[] = [
  {
    id: 'tx1', dateCash: '2026-09-20', accountId: 'acc', amountNet: 30_000, vatMode: 'excl',
    vatRate: 0.18, vatAmount: 5_400, amountGross: 35_400, nature: 'income', division: 'finance',
    txClass: 'business', certainty: 'actual', invoiceStatus: 'has_invoice', dealId: 'd1',
  },
]

// 150 ₪/ליד אבינועם (4 לידים), 200 ₪/ליד אלכס (2 לידים)
const leadCosts: LeadCost[] = [
  { id: 'c1', date: '2026-09-15', sourceId: 'avinoam', amount: 600 },
  { id: 'c2', date: '2026-09-15', sourceId: 'alex', amount: 400 },
]

describe('יחס המרה שבועי — SPEC §3.8', () => {
  const rows = computeWeeklyConversion({ leads, leadCosts, deals, txs })
  const avinoam = rows.find((r) => r.sourceId === 'avinoam')!
  const alex = rows.find((r) => r.sourceId === 'alex')!

  it('השלבים נצברים: ליד שחתם נספר גם בפגישות', () => {
    expect(avinoam.leads).toBe(4)
    expect(avinoam.meetings).toBe(3) // l1, l2, l3
    expect(avinoam.signings).toBe(2) // l1, l2
  })

  it('סגירות = תיקים שנגבה מהם בפועל, לא תיקים שנחתמו', () => {
    expect(avinoam.signings).toBe(2)
    expect(avinoam.collections).toBe(1) // רק d1 נגבה
  })

  it('יחסי המרה', () => {
    expect(avinoam.conversionToSigning).toBe(0.5)
    expect(avinoam.conversionToCollection).toBe(0.25)
  })

  it('עלות ליד ו-CAC', () => {
    expect(avinoam.costPerLead).toBe(150)
    expect(avinoam.cac).toBe(300) // 600 ÷ 2 חתימות
    expect(alex.costPerLead).toBe(200)
  })

  it('ערוץ בלי חתימות מחזיר CAC null ולא חלוקה באפס', () => {
    expect(alex.signings).toBe(0)
    expect(alex.cac).toBeNull()
    expect(alex.roi).toBe(0)
  })

  it('הכנסה ו-ROI מבוססים על כסף שנגבה בפועל', () => {
    expect(avinoam.revenue).toBe(30_000)
    expect(avinoam.revenuePerLead).toBe(7_500)
    expect(avinoam.roi).toBe(50)
  })

  it('השורות מקובצות לפי שבוע × ערוץ × מוצר', () => {
    expect(avinoam.week).toBe(WEEK)
    expect(rows).toHaveLength(2)
  })
})

describe('מסקנות אוטומטיות — SPEC §3.8', () => {
  const rows = computeWeeklyConversion({ leads, leadCosts, deals, txs })

  it('ערוץ עם 0 חתימות ב-4 שבועות מסומן', () => {
    const flags = flagChannels(rows, WEEK)
    expect(flags.some((f) => f.sourceId === 'alex' && f.kind === 'no_signings')).toBe(true)
  })

  it('ערוץ עם CAC מעל ממוצע ×1.5 מסומן', () => {
    const expensive = [
      ...rows,
      { ...rows[0]!, sourceId: 'expensive', cac: 10_000, signings: 1, leads: 1 },
    ]
    const flags = flagChannels(expensive, WEEK)
    expect(flags.some((f) => f.sourceId === 'expensive' && f.kind === 'cac_above_average')).toBe(true)
  })

  it('ערוץ תקין אינו מסומן', () => {
    const flags = flagChannels(rows, WEEK)
    expect(flags.some((f) => f.sourceId === 'avinoam')).toBe(false)
  })
})
