import { sql } from '@/lib/db'
import { flagChannels, type ChannelFlag, type ConversionRow } from '@/lib/rules/conversion.js'

/**
 * מסך 14 — לידים והמרה (SPEC §3.8, §4.5).
 * המספרים מ-v_conversion; המסקנות האוטומטיות מ-lib/rules/conversion.ts,
 * כדי שהמסך והבדיקות יסכימו על אותו כלל.
 */

export interface ConversionViewRow {
  week: string
  source_name: string
  source_id: string
  product: string
  leads: number
  contacted: number
  meetings: number
  proposals: number
  signings: number
  collections: number
  conversion_to_signing: number | null
  conversion_to_collection: number | null
  lead_cost: number
  cost_per_lead: number | null
  cac: number | null
  revenue: number
  revenue_per_lead: number | null
  roi: number | null
}

export async function conversionWeeks(weeks = 13): Promise<ConversionViewRow[]> {
  return sql<ConversionViewRow[]>`
    select week::text, source_name, source_id::text, product, leads::int, contacted::int, meetings::int,
           proposals::int, signings::int, collections::int, conversion_to_signing, conversion_to_collection,
           lead_cost, cost_per_lead, cac, revenue, revenue_per_lead, roi
    from v_conversion
    where week >= current_date - (${weeks}::int * 7)
    order by week desc, source_name`
}

const toRule = (r: ConversionViewRow): ConversionRow => ({
  week: r.week,
  sourceId: r.source_id,
  product: r.product,
  leads: Number(r.leads),
  contacted: Number(r.contacted),
  meetings: Number(r.meetings),
  proposals: Number(r.proposals),
  signings: Number(r.signings),
  collections: Number(r.collections),
  conversionToSigning: r.conversion_to_signing === null ? null : Number(r.conversion_to_signing),
  conversionToCollection: r.conversion_to_collection === null ? null : Number(r.conversion_to_collection),
  leadCost: Number(r.lead_cost),
  costPerLead: r.cost_per_lead === null ? null : Number(r.cost_per_lead),
  cac: r.cac === null ? null : Number(r.cac),
  revenue: Number(r.revenue),
  revenuePerLead: r.revenue_per_lead === null ? null : Number(r.revenue_per_lead),
  roi: r.roi === null ? null : Number(r.roi),
})

/** §3.8 — "מסקנות אוטומטיות": CAC מעל ממוצע ×1.5, ו-4 שבועות בלי חתימה. */
export function conversionFlags(rows: ConversionViewRow[], asOfWeek: string): (ChannelFlag & { sourceName: string })[] {
  const names = new Map(rows.map((r) => [r.source_id, r.source_name]))
  return flagChannels(rows.map(toRule), asOfWeek).map((f) => ({ ...f, sourceName: names.get(f.sourceId) ?? f.sourceId }))
}

export interface FunnelStage { stage: string; label: string; count: number; amount: number }

/**
 * §5.1 — "משפך שלנו: לידים → קשר → פגישה → חתם → נגבה. **עם ₪ בכל שלב**".
 * הכמות היא המכנה; הכסף הוא מה שמסתכלים עליו.
 */
export async function funnel(days = 90): Promise<FunnelStage[]> {
  const [r] = await sql<{
    leads: number; contacted: number; meetings: number; signed: number
    signed_fee: number; collected: number; pipeline_fee: number; cost: number
  }[]>`
    with l as (
      select * from leads where deleted_at is null and date >= current_date - ${days}::int
    )
    select
      (select count(*) from l)::int                                                as leads,
      (select count(*) from l where stage <> 'received')::int                      as contacted,
      (select count(*) from l where stage in ('meeting', 'proposal', 'signed', 'closed_won'))::int as meetings,
      (select count(*) from l where stage in ('signed', 'closed_won'))::int         as signed,
      coalesce((select sum(d.fee_agreed_net) from deals d
                where d.id in (select deal_id from l where deal_id is not null) and d.deleted_at is null), 0) as signed_fee,
      coalesce((select sum(b.collected_net) from v_deal_balance b
                where b.deal_id in (select deal_id from l where deal_id is not null)), 0) as collected,
      coalesce((select sum(d.fee_agreed_net) from deals d
                where d.id in (select deal_id from l where deal_id is not null)
                  and d.deleted_at is null and d.status = 'open'), 0)               as pipeline_fee,
      coalesce((select sum(abs(c.amount)) from lead_costs c
                where c.deleted_at is null and c.date >= current_date - ${days}::int), 0) as cost`
  const f = r ?? { leads: 0, contacted: 0, meetings: 0, signed: 0, signed_fee: 0, collected: 0, pipeline_fee: 0, cost: 0 }
  return [
    { stage: 'leads', label: 'לידים', count: Number(f.leads), amount: -Number(f.cost) },
    { stage: 'contacted', label: 'נוצר קשר', count: Number(f.contacted), amount: 0 },
    { stage: 'meeting', label: 'פגישה', count: Number(f.meetings), amount: 0 },
    { stage: 'signed', label: 'חתם', count: Number(f.signed), amount: Number(f.signed_fee) },
    { stage: 'collected', label: 'נגבה', count: Number(f.signed), amount: Number(f.collected) },
  ]
}

export interface SourceSummary {
  source_id: string; source_name: string; leads: number; signings: number
  cost: number; revenue: number; cac: number | null; roi: number | null
}

export async function sourceSummary(days = 90): Promise<SourceSummary[]> {
  return sql<SourceSummary[]>`
    select source_id::text, source_name,
           sum(leads)::int as leads, sum(signings)::int as signings,
           sum(lead_cost) as cost, sum(revenue) as revenue,
           case when sum(signings) > 0 then round(sum(lead_cost) / sum(signings), 2) end as cac,
           case when sum(lead_cost) > 0 then round(sum(revenue) / sum(lead_cost), 2) end as roi
    from v_conversion
    where week >= current_date - ${days}::int
    group by source_id, source_name
    order by sum(revenue) desc`
}

/** היטמאפ ערוץ × מוצר (§3.8) — הכמות והכסף יחד. */
export async function channelProductGrid(days = 90): Promise<{ source_name: string; product: string; leads: number; signings: number; revenue: number }[]> {
  return sql`
    select source_name, product, sum(leads)::int as leads, sum(signings)::int as signings, sum(revenue) as revenue
    from v_conversion where week >= current_date - ${days}::int
    group by source_name, product order by source_name, product`
}

export interface LeadRow {
  id: string; date: string; name: string | null; phone: string | null; email: string | null
  source_name: string; product: string; stage: string; deal_id: string | null; notes: string | null; wise_ref: string | null
}

export async function listLeads(limit = 300): Promise<LeadRow[]> {
  return sql<LeadRow[]>`
    select l.id, to_char(l.date, 'YYYY-MM-DD') as date, l.name, l.phone, l.email,
           s.name as source_name, l.product, l.stage::text, l.deal_id::text, l.notes, l.wise_ref
    from leads l join lead_sources s on s.id = l.source_id
    where l.deleted_at is null
    order by l.date desc, l.name limit ${limit}`
}

export async function leadSources(): Promise<{ id: string; name: string; cost_model: string; unit_cost: number | null }[]> {
  return sql`select id, name, cost_model, unit_cost from lead_sources where deleted_at is null and active order by name`
}

export async function leadCosts(days = 90): Promise<{ id: string; date: string; source_name: string; amount: number; note: string | null }[]> {
  return sql`
    select c.id, to_char(c.date, 'YYYY-MM-DD') as date, s.name as source_name, c.amount, c.note
    from lead_costs c join lead_sources s on s.id = c.source_id
    where c.deleted_at is null and c.date >= current_date - ${days}::int
    order by c.date desc`
}

/** §4.5 — ההגשות לבנקים שמזינות את ההסתברות. */
export async function submissionStats(): Promise<{ total: number; approved: number; banks: { bank: string; n: number; approved: number }[] }> {
  const [t] = await sql<{ total: number; approved: number }[]>`
    select count(*)::int as total, count(*) filter (where approved_at is not null)::int as approved
    from deal_submissions where deleted_at is null`
  const banks = await sql<{ bank: string; n: number; approved: number }[]>`
    select bank, count(*)::int as n, count(*) filter (where approved_at is not null)::int as approved
    from deal_submissions where deleted_at is null group by bank order by count(*) desc`
  return { total: t?.total ?? 0, approved: t?.approved ?? 0, banks }
}
