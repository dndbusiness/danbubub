import { describe, expect, it } from 'vitest'
import {
  bucketFor,
  computeCollections,
  findCollectionFlags,
} from '@/lib/rules/collections.js'
import type { Deal, DealPaymentPlan, Transaction } from '@/lib/rules/types.js'

const ASOF = '2026-09-18'

function deal(over: Partial<Deal> & { id: string }): Deal {
  return {
    clientName: over.id, division: 'finance', product: 'business_credit',
    stage: 'execution', collectionStatus: 'not_collected', feeAgreedNet: 0,
    feeMode: 'fixed', status: 'open', ...over,
  }
}

function income(id: string, amount: number, date: string, dealId: string, invoiceStatus: Transaction['invoiceStatus'] = 'has_invoice'): Transaction {
  return {
    id, dateCash: date, accountId: 'acc', amountNet: amount, vatMode: 'excl', vatRate: 0.18,
    vatAmount: amount * 0.18, amountGross: amount * 1.18, nature: 'income', division: 'finance',
    txClass: 'business', certainty: 'actual', invoiceStatus, dealId,
  }
}

describe('גיול — ADDENDUM ב.6', () => {
  it.each([
    [0, '0-30'], [30, '0-30'], [31, '31-60'], [60, '31-60'],
    [61, '61-90'], [90, '61-90'], [91, '90+'], [400, '90+'],
  ] as const)('%s ימים → %s', (days, bucket) => {
    expect(bucketFor(days)).toBe(bucket)
  })
})

describe('גביה פתוחה — ADDENDUM ב.6', () => {
  const deals = [
    deal({ id: 'd1', feeAgreedNet: 40_000, expectedCloseDate: '2026-06-01' }),  // 109 יום
    deal({ id: 'd2', feeAgreedNet: 30_000, expectedCloseDate: '2026-08-20' }),  // 29 יום
    deal({ id: 'd3', feeAgreedNet: 20_000, expectedCloseDate: '2026-09-25' }),  // עתידי
    deal({ id: 'd4', feeAgreedNet: 50_000, status: 'lost' }),                   // אבוד
  ]
  const txs = [income('t1', 15_000, '2026-07-01', 'd1')]  // שולם חלקית
  const plans: DealPaymentPlan[] = [
    { id: 'p1', dealId: 'd1', label: 'יתרה', amountNet: 25_000, expectedDate: '2026-06-01', certainty: 'committed', probability: 1 },
    { id: 'p2', dealId: 'd2', label: 'success fee', amountNet: 30_000, expectedDate: '2026-08-20', certainty: 'expected', probability: 0.5 },
  ]

  const result = computeCollections({ asOf: ASOF, deals, plans, txs })

  it('יתרה פתוחה = שכ"ט − נגבה בפועל', () => {
    const d1 = result.rows.find((r) => r.dealId === 'd1')!
    expect(d1.openAmount).toBe(25_000)
  })

  it('מפוצל לוודאי ופוטנציאלי — מה ש-WISE לא מבחין בו', () => {
    expect(result.totalCommitted).toBe(25_000)
    expect(result.totalExpected).toBe(30_000)
  })

  it('תיק אבוד לא נכנס לגביה', () => {
    expect(result.rows.map((r) => r.dealId)).not.toContain('d4')
  })

  it('תיק ששולם במלואו לא נכנס', () => {
    const paid = computeCollections({
      asOf: ASOF, deals: [deal({ id: 'dp', feeAgreedNet: 10_000 })],
      plans: [], txs: [income('tp', 10_000, '2026-09-01', 'dp')],
    })
    expect(paid.rows).toHaveLength(0)
  })

  it('גיול לפי דליים', () => {
    const b90 = result.aging.find((a) => a.bucket === '90+')!
    const b30 = result.aging.find((a) => a.bucket === '0-30')!
    expect(b90.amount).toBe(25_000)  // d1, 109 יום
    expect(b90.dealCount).toBe(1)
    // d2 (29 יום) ו-d3 (עתידי, 0 ימים) בדלי הראשון
    expect(b30.dealCount).toBe(2)
  })

  it('תאריך עתידי אינו באיחור', () => {
    expect(result.rows.find((r) => r.dealId === 'd3')!.daysOverdue).toBe(0)
  })

  it('ממוין לפי ימי איחור', () => {
    expect(result.rows[0]!.dealId).toBe('d1')
  })

  it('סינון לפי פעילות', () => {
    const re = computeCollections({
      asOf: ASOF,
      deals: [...deals, deal({ id: 'dre', division: 'realestate', feeAgreedNet: 80_000 })],
      plans: [], txs: [], division: 'realestate',
    })
    expect(re.rows.map((r) => r.dealId)).toEqual(['dre'])
  })
})

describe('דגלים אוטומטיים — ADDENDUM ב.6', () => {
  const deals = [deal({ id: 'd1', feeAgreedNet: 40_000, stage: 'completed', status: 'won' })]
  const txs = [
    income('t-old', 20_000, '2026-09-01', 'd1', 'missing'),   // 17 יום ללא חשבונית
    income('t-new', 5_000, '2026-09-16', 'd1', 'missing'),    // 2 ימים — עדיין לא
    income('t-ok', 5_000, '2026-08-01', 'd1', 'has_invoice'), // יש חשבונית
  ]
  const collections = computeCollections({ asOf: ASOF, deals, plans: [], txs })

  const flags = findCollectionFlags({
    asOf: ASOF, txs, deals, collections,
    issuedUnpaid: [
      { id: 'i1', date: '2026-08-01', counterparty: 'כהן', amountGross: 11_800 },  // 48 יום
      { id: 'i2', date: '2026-09-10', counterparty: 'לוי', amountGross: 5_900 },   // 8 ימים
    ],
  })

  it('תקבול ללא חשבונית מס תוך 7 ימים', () => {
    const f = flags.filter((x) => x.kind === 'receipt_without_invoice')
    expect(f).toHaveLength(1)
    expect(f[0]!.refId).toBe('t-old')
  })

  it('חשבונית שהוצאה ולא שולמה 30 יום', () => {
    const f = flags.filter((x) => x.kind === 'invoice_unpaid_30d')
    expect(f).toHaveLength(1)
    expect(f[0]!.refId).toBe('i1')
    expect(f[0]!.days).toBe(48)
  })

  it('תיק "הושלם" עם יתרה פתוחה', () => {
    const f = flags.filter((x) => x.kind === 'completed_deal_open_balance')
    expect(f).toHaveLength(1)
    expect(f[0]!.amount).toBe(10_000) // 40,000 − 30,000 שנגבו
  })

  it('לכל דגל ruleKey ייחודי — ADDENDUM הנחיה 18', () => {
    const keys = flags.map((f) => f.ruleKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
