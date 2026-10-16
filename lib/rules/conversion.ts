/**
 * יחס המרה שבועי — SPEC §3.8.
 *
 * לכל שבוע × ערוץ × מוצר:
 *   לידים · נוצר_קשר · פגישות · הצעות · חתימות · סגירות(נגבה)
 *   המרה_לחתימה = חתימות / לידים
 *   המרה_לגביה  = סגירות / לידים
 *   עלות_ליד    = Σ lead_costs(ערוץ) / לידים
 *   CAC         = Σ lead_costs(ערוץ) / חתימות
 *   הכנסה_לליד  = Σ income actual (deals from ערוץ) / לידים
 *   ROI         = הכנסה / עלות
 *
 * העיקרון מ-§5.1: המשפך שלנו הוא ב-₪, לא בכמויות. הכמות היא רק המכנה.
 */

import { divMoney, round2, sumBy, type Shekels } from './money.js'
import { weekKey, type IsoDate } from './period.js'
import type { Deal, Lead, LeadCost, Transaction } from './types.js'

/** השלבים נצברים: ליד שהגיע ל"חתם" נספר גם ב"פגישה". */
const STAGE_ORDER = ['received', 'contacted', 'meeting', 'proposal', 'signed', 'closed_won'] as const

const STAGE_RANK: Record<string, number> = {
  received: 0,
  contacted: 1,
  meeting: 2,
  proposal: 3,
  signed: 4,
  closed_won: 5,
  closed_lost: -1, // אבוד — נספר רק ברמה שאליה הגיע, ולכן מטופל בנפרד
}

export interface ConversionRow {
  week: IsoDate
  sourceId: string
  product: string
  leads: number
  contacted: number
  meetings: number
  proposals: number
  signings: number
  /** סגירות = תיקים שנגבה מהם בפועל. */
  collections: number
  conversionToSigning: number | null
  conversionToCollection: number | null
  leadCost: Shekels
  costPerLead: Shekels | null
  /** עלות רכישת לקוח. */
  cac: Shekels | null
  revenue: Shekels
  revenuePerLead: Shekels | null
  roi: number | null
}

export interface ConversionOptions {
  leads: readonly Lead[]
  leadCosts: readonly LeadCost[]
  deals: readonly Deal[]
  txs: readonly Transaction[]
}

export function computeWeeklyConversion(opts: ConversionOptions): ConversionRow[] {
  const { leads, leadCosts, deals, txs } = opts
  const dealById = new Map(deals.map((d) => [d.id, d]))

  // הכנסה בפועל לפי תיק
  const revenueByDeal = new Map<string, Shekels>()
  for (const tx of txs) {
    if (tx.nature !== 'income' || tx.certainty !== 'actual' || !tx.dealId) continue
    revenueByDeal.set(tx.dealId, (revenueByDeal.get(tx.dealId) ?? 0) + tx.amountNet)
  }

  type Bucket = { leads: Lead[]; week: IsoDate; sourceId: string; product: string }
  const buckets = new Map<string, Bucket>()

  for (const lead of leads) {
    const week = weekKey(lead.date)
    const key = `${week}|${lead.sourceId}|${lead.product}`
    const bucket = buckets.get(key)
    if (bucket) bucket.leads.push(lead)
    else buckets.set(key, { leads: [lead], week, sourceId: lead.sourceId, product: lead.product })
  }

  // עלויות ערוץ לפי שבוע. חבילות (אלכס: 200 ₪/ליד ב-~2.5 חודשים) נפרסות
  // בייבוא לשורות שבועיות — כאן כל שורת עלות כבר נושאת תאריך.
  const costByWeekSource = new Map<string, Shekels>()
  for (const cost of leadCosts) {
    const key = `${weekKey(cost.date)}|${cost.sourceId}`
    costByWeekSource.set(key, (costByWeekSource.get(key) ?? 0) + Math.abs(cost.amount))
  }

  const rows: ConversionRow[] = []

  for (const bucket of buckets.values()) {
    const reached = (stage: (typeof STAGE_ORDER)[number]) =>
      bucket.leads.filter((l) => (STAGE_RANK[l.stage] ?? -1) >= STAGE_RANK[stage]!).length

    const leadCount = bucket.leads.length
    const signings = reached('signed')

    const convertedDeals = bucket.leads
      .map((l) => (l.dealId ? dealById.get(l.dealId) : undefined))
      .filter((d): d is Deal => Boolean(d))

    const collections = convertedDeals.filter((d) => (revenueByDeal.get(d.id) ?? 0) > 0).length
    const revenue = sumBy(convertedDeals, (d) => revenueByDeal.get(d.id) ?? 0)

    // עלות הערוץ באותו שבוע מתחלקת בין המוצרים לפי מספר הלידים.
    const weekSourceLeads = [...buckets.values()]
      .filter((b) => b.week === bucket.week && b.sourceId === bucket.sourceId)
      .reduce((a, b) => a + b.leads.length, 0)
    const weekSourceCost = costByWeekSource.get(`${bucket.week}|${bucket.sourceId}`) ?? 0
    const leadCost =
      weekSourceLeads > 0 ? round2((weekSourceCost * leadCount) / weekSourceLeads) : round2(weekSourceCost)

    rows.push({
      week: bucket.week,
      sourceId: bucket.sourceId,
      product: bucket.product,
      leads: leadCount,
      contacted: reached('contacted'),
      meetings: reached('meeting'),
      proposals: reached('proposal'),
      signings,
      collections,
      conversionToSigning: leadCount ? signings / leadCount : null,
      conversionToCollection: leadCount ? collections / leadCount : null,
      leadCost,
      costPerLead: leadCount ? divMoney(leadCost, leadCount) : null,
      cac: signings ? divMoney(leadCost, signings) : null,
      revenue,
      revenuePerLead: leadCount ? divMoney(revenue, leadCount) : null,
      roi: leadCost > 0 ? round2(revenue / leadCost) : null,
    })
  }

  return rows.sort((a, b) => (a.week === b.week ? a.sourceId.localeCompare(b.sourceId) : a.week < b.week ? -1 : 1))
}

// ── מסקנות אוטומטיות (SPEC §3.8) ──────────────────────────────────────────

export interface ChannelFlag {
  sourceId: string
  kind: 'cac_above_average' | 'no_signings'
  label: string
}

/**
 * "ערוץ עם CAC מעל ממוצע ×1.5 → דגל; ערוץ עם 0 חתימות ב-4 שבועות → דגל."
 */
export function flagChannels(rows: readonly ConversionRow[], asOfWeek: IsoDate): ChannelFlag[] {
  const flags: ChannelFlag[] = []

  const withCac = rows.filter((r) => r.cac !== null)
  if (withCac.length) {
    const avgCac = withCac.reduce((a, r) => a + (r.cac ?? 0), 0) / withCac.length
    const threshold = avgCac * 1.5
    const bySource = new Map<string, number[]>()
    for (const r of withCac) {
      const list = bySource.get(r.sourceId) ?? []
      list.push(r.cac ?? 0)
      bySource.set(r.sourceId, list)
    }
    for (const [sourceId, cacs] of bySource) {
      const sourceAvg = cacs.reduce((a, b) => a + b, 0) / cacs.length
      if (sourceAvg > threshold) {
        flags.push({
          sourceId,
          kind: 'cac_above_average',
          label: `CAC ${round2(sourceAvg)} ₪ — מעל ממוצע ×1.5 (${round2(threshold)} ₪)`,
        })
      }
    }
  }

  // 4 שבועות אחרונים ללא חתימות
  const fourWeeksAgo = shiftWeeks(asOfWeek, -4)
  const recent = rows.filter((r) => r.week >= fourWeeksAgo && r.week <= asOfWeek)
  const sources = new Set(recent.map((r) => r.sourceId))
  for (const sourceId of sources) {
    const sourceRows = recent.filter((r) => r.sourceId === sourceId)
    const signings = sourceRows.reduce((a, r) => a + r.signings, 0)
    const leads = sourceRows.reduce((a, r) => a + r.leads, 0)
    if (signings === 0 && leads > 0) {
      flags.push({
        sourceId,
        kind: 'no_signings',
        label: `${leads} לידים ב-4 שבועות, 0 חתימות`,
      })
    }
  }

  return flags
}

function shiftWeeks(week: IsoDate, delta: number): IsoDate {
  const d = new Date(`${week}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta * 7)
  return d.toISOString().slice(0, 10)
}
