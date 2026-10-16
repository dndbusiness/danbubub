import { sql } from '@/lib/db'
import { summarizePrivateIncome, type PrivateIncomeRow } from '@/lib/rules/private.js'

/**
 * מסך 9 — הכנסות פרייבט (SPEC §2.1).
 * "הטבלה הזו לא מצטרפת לשום שאילתה של transactions" — ולכן גם כאן אין join
 * אחד לעולם העסקי. הסיכומים מ-lib/rules/private.ts, כדי שהמסך וה-view יסכימו.
 */

export interface PrivateRow {
  id: string
  fund_name: string
  deal_ref: string | null
  deal_amount: number | null
  threshold_rule: unknown
  pct: number | null
  amount_net: number
  vat_amount: number
  amount_gross: number
  split_dan: number
  split_nissim: number
  dan_amount: number
  nissim_amount: number
  received_date: string | null
  received_to: string | null
  status: 'expected' | 'received'
  note: string | null
}

export async function privateRows(): Promise<PrivateRow[]> {
  return sql<PrivateRow[]>`
    select id, fund_name, deal_ref, deal_amount, threshold_rule, pct, amount_net, vat_amount,
           amount_gross, split_dan, split_nissim, dan_amount, nissim_amount,
           to_char(received_date, 'YYYY-MM-DD') as received_date, received_to, status, note
    from v_private_income
    order by (status = 'received') desc, received_date desc nulls last, amount_net desc`
}

const toRule = (r: PrivateRow): PrivateIncomeRow => ({
  id: r.id,
  fundName: r.fund_name,
  dealRef: r.deal_ref,
  dealAmount: r.deal_amount === null ? null : Number(r.deal_amount),
  pct: r.pct === null ? null : Number(r.pct),
  amountNet: Number(r.amount_net),
  vatAmount: Number(r.vat_amount),
  splitDan: Number(r.split_dan),
  splitNissim: Number(r.split_nissim),
  status: r.status,
  receivedDate: r.received_date,
})

export async function privateSummary(rows?: PrivateRow[]) {
  const list = rows ?? (await privateRows())
  return summarizePrivateIncome(list.map(toRule))
}

/** מה שה-view מחזיר — לבדיקת הזהות מול lib/rules (§8). */
export async function privateSummaryFromView(): Promise<{ status: string; rows_count: number; amount_net: number; dan_amount: number; nissim_amount: number }[]> {
  return sql`select status, rows_count, amount_net, dan_amount, nissim_amount from v_private_income_summary order by status`
}
