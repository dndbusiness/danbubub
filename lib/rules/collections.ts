/**
 * גביה פתוחה ותפעול חשבוניות — ADDENDUM ב.6 (מסך 20).
 *
 * גיול (aging) של היתרות הפתוחות, מצב המסמך לכל תקבול, והדגלים האוטומטיים:
 *   • תקבול בבנק ללא חשבונית מס תוך 7 ימים
 *   • חשבונית מס שהוצאה ולא שולמה 30 יום
 *   • תיק "הושלם" עם יתרה פתוחה
 */

import { absMoney, round2, sumBy, type Shekels } from './money.js'
import { daysBetween, type IsoDate } from './period.js'
import type { ConcreteDivision, Deal, DealPaymentPlan, Transaction } from './types.js'

/** ADDENDUM ב.6 — 0–30 / 31–60 / 61–90 / 90+. */
export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+'

export const AGING_BUCKETS: readonly AgingBucket[] = ['0-30', '31-60', '61-90', '90+']

export function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 30) return '0-30'
  if (daysOverdue <= 60) return '31-60'
  if (daysOverdue <= 90) return '61-90'
  return '90+'
}

/** ADDENDUM ב.6 — סטטוס המסמך לכל תקבול. */
export type DocumentStatus = 'not_issued' | 'invoice_issued' | 'paid' | 'receipt_issued'

export interface CollectionRow {
  dealId: string
  clientName: string
  division: ConcreteDivision
  /** הסכום הפתוח. */
  openAmount: Shekels
  /** ודאי מול פוטנציאלי — הפיצול ש-WISE לא מבחין בו (§5.1). */
  openCommitted: Shekels
  openExpected: Shekels
  dueDate: IsoDate | null
  daysOverdue: number
  bucket: AgingBucket
  documentStatus: DocumentStatus
  lastReminderAt?: IsoDate
  ownerUserId?: string
}

export interface AgingSummary {
  bucket: AgingBucket
  amount: Shekels
  dealCount: number
}

export interface CollectionsResult {
  rows: CollectionRow[]
  aging: AgingSummary[]
  totalOpen: Shekels
  totalCommitted: Shekels
  totalExpected: Shekels
}

export interface CollectionsOptions {
  asOf: IsoDate
  deals: readonly Deal[]
  plans: readonly DealPaymentPlan[]
  txs: readonly Transaction[]
  /** סטטוס המסמך לכל תיק, מ-`invoices`. */
  documentStatusByDeal?: ReadonlyMap<string, DocumentStatus>
  lastReminderByDeal?: ReadonlyMap<string, IsoDate>
  division?: ConcreteDivision
}

export function computeCollections(opts: CollectionsOptions): CollectionsResult {
  const {
    asOf,
    deals,
    plans,
    txs,
    documentStatusByDeal = new Map<string, DocumentStatus>(),
    lastReminderByDeal = new Map<string, IsoDate>(),
    division,
  } = opts

  const collectedByDeal = new Map<string, Shekels>()
  for (const tx of txs) {
    if (tx.nature !== 'income' || tx.certainty !== 'actual' || !tx.dealId) continue
    collectedByDeal.set(tx.dealId, (collectedByDeal.get(tx.dealId) ?? 0) + tx.amountNet)
  }

  const rows: CollectionRow[] = []

  for (const deal of deals) {
    if (division && deal.division !== division) continue
    if (deal.status === 'lost' || deal.status === 'cancelled') continue

    const collected = round2(collectedByDeal.get(deal.id) ?? 0)
    const openAmount = round2(deal.feeAgreedNet - collected)
    if (openAmount <= 0) continue

    const openPlans = plans.filter((p) => p.dealId === deal.id && !p.matchedTxId)
    const openCommitted = sumBy(
      openPlans.filter((p) => p.certainty === 'committed'),
      (p) => p.amountNet,
    )
    const openExpected = sumBy(
      openPlans.filter((p) => p.certainty === 'expected'),
      (p) => p.amountNet,
    )

    // תאריך היעד: המוקדם מבין התקבולים הפתוחים, אחרת תאריך הסגירה הצפוי.
    const dueDate =
      openPlans.map((p) => p.expectedDate).sort()[0] ?? deal.expectedCloseDate ?? null

    const daysOverdue = dueDate ? Math.max(0, daysBetween(dueDate, asOf)) : 0

    rows.push({
      dealId: deal.id,
      clientName: deal.clientName,
      division: deal.division,
      openAmount,
      openCommitted,
      openExpected,
      dueDate,
      daysOverdue,
      bucket: bucketFor(daysOverdue),
      documentStatus: documentStatusByDeal.get(deal.id) ?? 'not_issued',
      lastReminderAt: lastReminderByDeal.get(deal.id),
      ownerUserId: deal.ownerUserId,
    })
  }

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.openAmount - a.openAmount)

  const aging = AGING_BUCKETS.map((bucket) => {
    const inBucket = rows.filter((r) => r.bucket === bucket)
    return {
      bucket,
      amount: sumBy(inBucket, (r) => r.openAmount),
      dealCount: inBucket.length,
    }
  })

  return {
    rows,
    aging,
    totalOpen: sumBy(rows, (r) => r.openAmount),
    totalCommitted: sumBy(rows, (r) => r.openCommitted),
    totalExpected: sumBy(rows, (r) => r.openExpected),
  }
}

// ── דגלים אוטומטיים (ADDENDUM ב.6) ─────────────────────────────────────────

export type CollectionFlagKind =
  | 'receipt_without_invoice'
  | 'invoice_unpaid_30d'
  | 'completed_deal_open_balance'

export interface CollectionFlag {
  kind: CollectionFlagKind
  /** ADDENDUM הנחיה 18 — מפתח ייחודי, כדי שלא ייווצרו שתי משימות לאותו פער. */
  ruleKey: string
  dealId?: string
  refId: string
  label: string
  amount: Shekels
  days?: number
}

export const RECEIPT_WITHOUT_INVOICE_DAYS = 7
export const INVOICE_UNPAID_DAYS = 30

export function findCollectionFlags(opts: {
  asOf: IsoDate
  txs: readonly Transaction[]
  deals: readonly Deal[]
  /** חשבוניות שהוצאו ולא שודכו לתקבול. */
  issuedUnpaid: readonly { id: string; date: IsoDate; counterparty?: string; amountGross: Shekels }[]
  collections: CollectionsResult
}): CollectionFlag[] {
  const { asOf, txs, deals, issuedUnpaid, collections } = opts
  const flags: CollectionFlag[] = []

  // תקבול בבנק ללא חשבונית מס תוך 7 ימים
  for (const tx of txs) {
    if (tx.nature !== 'income' || tx.certainty !== 'actual') continue
    if (tx.invoiceStatus === 'has_invoice' || tx.invoiceStatus === 'no_invoice_needed') continue
    const days = daysBetween(tx.dateCash, asOf)
    if (days < RECEIPT_WITHOUT_INVOICE_DAYS) continue
    flags.push({
      kind: 'receipt_without_invoice',
      ruleKey: `receipt_without_invoice:${tx.id}`,
      dealId: tx.dealId,
      refId: tx.id,
      label: `תקבול ${absMoney(tx.amountNet)} ₪ מ-${tx.dateCash} ללא חשבונית מס`,
      amount: absMoney(tx.amountNet),
      days,
    })
  }

  // חשבונית מס שהוצאה ולא שולמה 30 יום
  for (const inv of issuedUnpaid) {
    const days = daysBetween(inv.date, asOf)
    if (days < INVOICE_UNPAID_DAYS) continue
    flags.push({
      kind: 'invoice_unpaid_30d',
      ruleKey: `invoice_unpaid:${inv.id}`,
      refId: inv.id,
      label: `חשבונית ל-${inv.counterparty ?? 'לקוח'} מ-${inv.date} לא שולמה ${days} יום`,
      amount: inv.amountGross,
      days,
    })
  }

  // תיק "הושלם" עם יתרה פתוחה
  const completedStages = new Set(['completed', 're_closed'])
  for (const row of collections.rows) {
    const deal = deals.find((d) => d.id === row.dealId)
    if (!deal) continue
    if (!completedStages.has(deal.stage) && deal.status !== 'won') continue
    flags.push({
      kind: 'completed_deal_open_balance',
      ruleKey: `completed_open_balance:${deal.id}`,
      dealId: deal.id,
      refId: deal.id,
      label: `תיק "${deal.clientName}" הושלם עם יתרה פתוחה ${row.openAmount} ₪`,
      amount: row.openAmount,
    })
  }

  return flags
}
