import { sql } from '@/lib/db'
import type { AgingBucket, DocumentStatus } from '@/lib/rules/collections'

export interface CollectionOpsRow {
  deal_id: string
  client_name: string
  division: string
  collection_status: string
  open_amount: number
  open_committed: number
  open_expected: number
  due_date: string | null
  days_overdue: number
  aging_bucket: AgingBucket
  stage: string
  status: string
  client_phone: string | null
  owner_name: string | null
  owner_email: string | null
  document_status: DocumentStatus
  last_invoice_date: string | null
  next_missing: string | null
  stuck_days: number | null
  completion_pct: number | null
  last_action_kind: string | null
  last_action_at: string | null
  last_action_channel: string | null
}

export async function listCollections(division: 'finance' | 'realestate' | 'all'): Promise<CollectionOpsRow[]> {
  return sql<CollectionOpsRow[]>`
    select deal_id, client_name, division, collection_status, open_amount, open_committed, open_expected,
           to_char(due_date, 'YYYY-MM-DD') as due_date, days_overdue::int, aging_bucket, stage, status,
           client_phone, owner_name, owner_email, document_status, to_char(last_invoice_date, 'YYYY-MM-DD') as last_invoice_date,
           next_missing, stuck_days::int, completion_pct, last_action_kind, last_action_at::text, last_action_channel
    from v_collections_ops
    where ${division === 'all'} or division = ${division === 'all' ? 'finance' : division}
    order by days_overdue desc, open_amount desc`
}

export interface AgingCell { aging_bucket: AgingBucket; amount: number; committed: number; expected: number; deal_count: number }

export async function agingSummary(division: 'finance' | 'realestate' | 'all'): Promise<AgingCell[]> {
  const rows = await sql<AgingCell[]>`
    select aging_bucket, sum(amount) as amount, sum(committed) as committed, sum(expected) as expected, sum(deal_count)::int as deal_count
    from v_collections_aging
    where ${division === 'all'} or division = ${division === 'all' ? 'finance' : division}
    group by aging_bucket`
  const by = new Map(rows.map((r) => [r.aging_bucket, r]))
  return (['0-30', '31-60', '61-90', '90+'] as AgingBucket[]).map(
    (b) => by.get(b) ?? { aging_bucket: b, amount: 0, committed: 0, expected: 0, deal_count: 0 },
  )
}

export interface CollectionFlagRow { kind: string; rule_key: string; deal_id: string | null; ref_id: string; subject: string; amount: number; days: number }

export async function collectionFlags(): Promise<CollectionFlagRow[]> {
  return sql<CollectionFlagRow[]>`select kind, rule_key, deal_id, ref_id, subject, amount, days::int from v_collection_flags order by days desc`
}

export interface ActionRow { id: string; deal_id: string; kind: string; channel: string | null; message: string | null; amount: number | null; note: string | null; created_at: string }

export async function dealActions(dealId: string): Promise<ActionRow[]> {
  return sql<ActionRow[]>`
    select id, deal_id, kind, channel, message, amount, note, created_at::text
    from collection_actions where deal_id = ${dealId} and deleted_at is null order by created_at desc limit 20`
}

/** ב.5 — "לביצוע וגביה": התיקים לפי הפריט החוסם, + הפילוח ברמת החברה. */
export async function executionPipeline() {
  const [rows, blockers] = await Promise.all([
    sql<{ deal_id: string; client_name: string; division: string; owner_name: string | null; amount_at_stake: number; next_missing: string | null; next_status: string | null; blocked_reason: string | null; stuck_days: number | null; completion_pct: number | null }[]>`
      select p.deal_id, p.client_name, p.division, u.full_name as owner_name, p.amount_at_stake, p.next_missing, p.next_status,
             p.blocked_reason, p.stuck_days::int, p.completion_pct
      from v_execution_pipeline p left join users u on u.id = p.owner_user_id
      order by p.amount_at_stake desc`,
    sql<{ blocker: string; deal_count: number; amount: number; pct_of_total: number }[]>`
      select blocker, deal_count::int, amount, pct_of_total from v_execution_blockers order by amount desc`,
  ])
  return { rows, blockers, total: rows.reduce((a, r) => a + r.amount_at_stake, 0) }
}

/** מועמדים ל"סמן שולם": תקבולים שנרשמו ולא שויכו לתיק. */
export async function unassignedIncome(amount: number) {
  return sql<{ id: string; date_cash: string; amount_net: number; counterparty: string | null; description: string | null }[]>`
    select id, to_char(date_cash, 'YYYY-MM-DD') as date_cash, amount_net, counterparty, description
    from transactions
    where nature = 'income' and certainty = 'actual' and deleted_at is null and deal_id is null
      and abs(amount_net - ${amount}) <= greatest(1, ${amount} * 0.02)
    order by date_cash desc limit 20`
}
