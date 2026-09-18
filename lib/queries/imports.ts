import { sql } from '@/lib/db'
import type { ClassificationRule } from '@/lib/rules/classify'

export interface BatchRow {
  id: string
  source: string
  file_name: string
  file_hash: string
  rows_total: number
  rows_created: number
  rows_skipped: number
  rows_flagged: number
  status: string
  account_id: string | null
  account_name: string | null
  meta: BatchMeta | null
  applied_at: string | null
  created_at: string
}

export interface BatchMeta {
  formatId: string
  formatLabel: string
  billingDate: string
  parentAmount: number
  warnings: string[]
  skipped: number
  dateFrom: string
  dateTo: string
  parentTxId?: string
  /** §4.2 — אימות יתרת הסגירה בדף הבנק. */
  openingBalance?: number | null
  closingBalance?: number | null
  computedClosing?: number | null
  balanceMatches?: boolean | null
  balanceGap?: number | null
  firstBalanceBreak?: { rowIndex: number; description: string; expected: number; found: number } | null
}

export interface ImportRow {
  id: string
  batch_id: string
  row_index: number
  source_ref: string
  date: string
  merchant: string
  amount: number
  amount_original: number | null
  reference: string | null
  category_hint: string | null
  notes: string | null
  card_last4: string | null
  rule_id: string | null
  matched_pattern: string | null
  nature: string
  division: string
  category_id: string | null
  category_name: string | null
  tx_class: string
  invoice_status: string
  deductible: boolean | null
  review_status: string
  decision: string
  edited: boolean
  applied_tx_id: string | null
  /** §4.2 — שידוך דף בנק לתנועה קיימת. */
  matched_tx_id: string | null
  match_status: 'matched' | 'candidates' | 'none'
  balance: number | null
  match_candidates: { txId: string; date: string; amount: number; label: string | null; score: number; reasons: string[] }[] | null
}

export async function listBatches(): Promise<BatchRow[]> {
  return sql<BatchRow[]>`
    select b.id, b.source, b.file_name, b.file_hash, b.rows_total, b.rows_created, b.rows_skipped, b.rows_flagged,
           b.status, b.account_id, a.name as account_name, b.meta, b.applied_at::text, b.created_at::text
    from import_batches b
    left join accounts a on a.id = b.account_id
    where b.deleted_at is null and b.source in ('card_import', 'bank_import')
    order by b.created_at desc
    limit 50`
}

export async function getBatch(id: string): Promise<{ batch: BatchRow; rows: ImportRow[] } | null> {
  const [batch] = await sql<BatchRow[]>`
    select b.id, b.source, b.file_name, b.file_hash, b.rows_total, b.rows_created, b.rows_skipped, b.rows_flagged,
           b.status, b.account_id, a.name as account_name, b.meta, b.applied_at::text, b.created_at::text
    from import_batches b
    left join accounts a on a.id = b.account_id
    where b.id = ${id} and b.deleted_at is null`
  if (!batch) return null
  const rows = await sql<ImportRow[]>`
    select r.id, r.batch_id, r.row_index, r.source_ref, r.date::text, r.merchant, r.amount, r.amount_original,
           r.reference, r.category_hint, r.notes, r.card_last4, r.rule_id, r.matched_pattern,
           r.nature, r.division, r.category_id, c.name as category_name, r.tx_class, r.invoice_status,
           r.deductible, r.review_status, r.decision, r.edited, r.applied_tx_id,
           r.matched_tx_id, r.match_status, r.balance, r.match_candidates
    from import_rows r
    left join categories c on c.id = r.category_id
    where r.batch_id = ${id} and r.deleted_at is null
    order by r.row_index`
  return { batch, rows }
}

/** הכללים הפעילים — בצורה ש-lib/rules/classify מבין. */
export async function listRules(): Promise<ClassificationRule[]> {
  const rows = await sql<{
    id: string; pattern: string; is_regex: boolean; account_id: string | null; set_category_id: string | null
    set_division: string | null; set_nature: string | null; set_tx_class: string | null
    set_invoice_status: string | null; set_deductible: boolean | null; priority: number; active: boolean
  }[]>`
    select id, pattern, is_regex, account_id, set_category_id, set_division, set_nature, set_tx_class,
           set_invoice_status, set_deductible, priority, active
    from rules where deleted_at is null and active
    order by priority, id`
  return rows.map((r) => ({
    id: r.id, pattern: r.pattern, isRegex: r.is_regex, accountId: r.account_id,
    setCategoryId: r.set_category_id, setDivision: r.set_division, setNature: r.set_nature,
    setTxClass: r.set_tx_class, setInvoiceStatus: r.set_invoice_status, setDeductible: r.set_deductible,
    priority: r.priority, active: r.active,
  }))
}

export interface RuleRow {
  id: string; pattern: string; is_regex: boolean; account_name: string | null; category_name: string | null
  set_division: string | null; set_nature: string | null; set_tx_class: string | null; hit_count: number; created_at: string
}

export async function listRuleRows(): Promise<RuleRow[]> {
  return sql<RuleRow[]>`
    select r.id, r.pattern, r.is_regex, a.name as account_name, c.name as category_name,
           r.set_division, r.set_nature, r.set_tx_class, r.hit_count, r.created_at::text
    from rules r
    left join accounts a on a.id = r.account_id
    left join categories c on c.id = r.set_category_id
    where r.deleted_at is null and r.active
    order by r.hit_count desc, r.created_at desc`
}

/** SPEC §4.4 — מדד האוטומציה: כמה מבנות האשראי סווגו לפי כלל (יעד 80% אחרי חודש). */
export async function automationRate(): Promise<{ total: number; auto: number; rate: number }> {
  const [r] = await sql<{ total: number; auto: number }[]>`
    select count(*)::int as total, count(*) filter (where rule_id is not null)::int as auto
    from import_rows where deleted_at is null and decision in ('approved', 'pending')`
  const total = r?.total ?? 0, auto = r?.auto ?? 0
  return { total, auto, rate: total ? auto / total : 0 }
}

/** מה כבר נמצא ב-transactions מאותו כרטיס — dedup מול ייבוא קודם (SPEC §11.9). */
export async function existingSourceRefs(accountId: string, refs: string[]): Promise<Set<string>> {
  if (!refs.length) return new Set()
  const rows = await sql<{ source_ref: string }[]>`
    select source_ref from transactions
    where account_id = ${accountId} and source = 'card_import' and deleted_at is null
      and source_ref = any(${refs})`
  return new Set(rows.map((r) => r.source_ref))
}

export interface CardAccount { id: string; name: string; billing_day: number | null; default_division: string; entity_name: string }

export async function listCardAccounts(): Promise<CardAccount[]> {
  return sql<CardAccount[]>`
    select a.id, a.name, a.billing_day, a.default_division, e.name as entity_name
    from accounts a join entities e on e.id = a.entity_id
    where a.type = 'credit_card' and a.deleted_at is null and a.active
    order by a.name`
}

/** חשבונות בנק — לייבוא דפי בנק (שלב 6). */
export async function listBankAccounts(): Promise<CardAccount[]> {
  return sql<CardAccount[]>`
    select a.id, a.name, a.billing_day, a.default_division, e.name as entity_name
    from accounts a join entities e on e.id = a.entity_id
    where a.type = 'bank' and a.deleted_at is null and a.active
    order by a.name`
}

export async function listEntities(): Promise<{ id: string; name: string }[]> {
  return sql<{ id: string; name: string }[]>`select id, name from entities where deleted_at is null order by name`
}

export async function bankAccountId(): Promise<string | null> {
  const [r] = await sql<{ id: string }[]>`select id from accounts where type = 'bank' and deleted_at is null and active order by created_at limit 1`
  return r?.id ?? null
}

export async function unclassifiedCategoryId(): Promise<string | null> {
  const [r] = await sql<{ id: string }[]>`select id from categories where name like 'לא מסווג%' and deleted_at is null limit 1`
  return r?.id ?? null
}
