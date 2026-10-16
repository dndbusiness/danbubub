import { sql, withActor } from '@/lib/db'
import { runJob } from './run'

/**
 * חלק ג' `greeninvoice_import` — "ידני שבועי (או לילי אם API)".
 * אין עדיין API (שאלה פתוחה #17), ולכן הג'וב לא מייבא לבד: הוא בודק שהייצוא
 * השבועי אכן נקלט, ואם לא — פותח משימה עם `rule_key` ייחודי (הנחיה 18).
 * ברגע שיהיה API, אותו ג'וב יקרא אותו במקום לפתוח את המשימה.
 */
export async function greenInvoiceImportJob(asOf: string): Promise<{ rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }> {
  return runJob('greeninvoice_import', async () => {
    const [last] = await sql<{ imported_at: string | null; days: number | null }[]>`
      select max(created_at)::text as imported_at,
             extract(day from ${asOf}::timestamptz - max(created_at))::int as days
      from import_batches where source = 'greeninvoice_import' and deleted_at is null`
    const days = last?.days ?? null
    if (days !== null && days < 7) return { rowsTouched: 0, skipped: `הייצוא נקלט לפני ${days} ימים`, detail: { lastImport: last?.imported_at } }

    // כמה פערים פתוחים — זה מה שהייצוא אמור לסגור (§4.3).
    const [gaps] = await sql<{ open: number; vat_at_risk: number }[]>`
      select count(*)::int as open, coalesce(sum(vat_at_risk), 0) as vat_at_risk
      from v_invoice_gaps where gap_kind = 'expense_without_invoice'`

    const week = asOf.slice(0, 10)
    const created = await withActor(async (tx) => {
      const res = await tx`
        insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
        values (${'לייצא הוצאות מחשבונית ירוקה ולקלוט למערכת'}, ${asOf}, ${(gaps?.open ?? 0) > 10 ? 'high' : 'normal'}, true,
                ${`greeninvoice_import:${week}`},
                ${`${gaps?.open ?? 0} הוצאות בלי חשבונית ספק · מע"מ בסיכון ${Math.round(Number(gaps?.vat_at_risk ?? 0))} ₪${last?.imported_at ? ` · ייבוא אחרון לפני ${days} ימים` : ' · טרם יובא ייצוא'}`})
        on conflict do nothing`
      return res.count
    })
    return { rowsTouched: created, detail: { lastImport: last?.imported_at, daysSince: days, openGaps: gaps?.open ?? 0 } }
  })
}
