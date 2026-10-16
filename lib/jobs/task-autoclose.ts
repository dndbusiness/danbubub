import { withActor } from '@/lib/db'

/**
 * ADDENDUM ב.10 — "משימה אוטומטית נסגרת לבד כשהתנאי מפסיק להתקיים
 * (חשבונית נקלטה → המשימה 'חסרה חשבונית' נסגרת עם הערה)."
 *
 * כל שורה כאן היא **זוג**: המפתח שפתח את המשימה, והתנאי שסוגר אותה.
 * המשימה לא נמחקת — היא עוברת ל-done עם הסבר, כדי שיישאר תיעוד.
 */
export interface AutoCloseResult { closed: number; byRule: Record<string, number> }

export async function closeResolvedAutoTasks(): Promise<AutoCloseResult> {
  return withActor(async (tx) => {
    const byRule: Record<string, number> = {}
    const close = async (prefix: string, note: string, sqlFragment: () => Promise<{ count: number }>) => {
      const res = await sqlFragment()
      if (res.count) byRule[prefix] = res.count
      void note
      return res.count
    }

    let closed = 0

    // תנועה לא מזוהה → סווגה, או שהתשובה התקבלה.
    closed += await close('unknown_expense', 'התנועה סווגה', () => tx`
      update tasks t set status = 'done', notes = coalesce(t.notes, '') || ' · נסגר אוטומטית: התנועה סווגה'
      where t.auto_generated and t.status <> 'done' and t.deleted_at is null
        and t.auto_key like 'unknown_expense:%'
        and exists (
          select 1 from transactions x
          where x.id = t.tx_id and x.deleted_at is null
            and x.review_status <> 'unknown_expense' and x.category_id is not null)`)

    // חשבונית חסרה → נקלטה או סומן שלא נדרשת.
    closed += await close('missing_invoice', 'החשבונית נקלטה', () => tx`
      update tasks t set status = 'done', notes = coalesce(t.notes, '') || ' · נסגר אוטומטית: החשבונית טופלה'
      where t.auto_generated and t.status <> 'done' and t.deleted_at is null
        and t.auto_key like 'missing_invoice:%'
        and exists (
          select 1 from transactions x
          where x.id = t.tx_id and x.deleted_at is null
            and x.invoice_status in ('has_invoice', 'no_invoice_needed'))`)

    // חשבונית במייל לאישור → אושרה או סומנה כלא רלוונטית.
    closed += await close('inbox', 'המסמך אושר', () => tx`
      update tasks t set status = 'done', notes = coalesce(t.notes, '') || ' · נסגר אוטומטית: המסמך טופל'
      where t.auto_generated and t.status <> 'done' and t.deleted_at is null
        and t.auto_key like 'inbox:%'
        and exists (
          select 1 from inbox_candidates c
          where t.auto_key = 'inbox:' || c.id::text and c.status <> 'pending')`)

    // חשבונית של ישות שותף → הוכרעה.
    closed += await close('partner_invoice', 'ההכרעה נעשתה', () => tx`
      update tasks t set status = 'done', notes = coalesce(t.notes, '') || ' · נסגר אוטומטית: ההכרעה נעשתה'
      where t.auto_generated and t.status <> 'done' and t.deleted_at is null
        and t.auto_key like 'partner_invoice:%'
        and exists (
          select 1 from invoices i
          where t.auto_key = 'partner_invoice:' || i.id::text and not i.needs_partner_review)`)

    // פריט צ'קליסט תקוע → הפריט עצמו כבר לא תקוע (auto_key: checklist_stuck:<תיק>:<פריט>).
    closed += await close('checklist_stuck', 'הפריט הושלם', () => tx`
      update tasks t set status = 'done', notes = coalesce(t.notes, '') || ' · נסגר אוטומטית: הפריט כבר לא תקוע'
      where t.auto_generated and t.status <> 'done' and t.deleted_at is null
        and t.auto_key like 'checklist_stuck:%'
        and not exists (
          select 1 from deal_checklist_items i
          where i.deal_id = t.deal_id
            and i.label = split_part(t.auto_key, ':', 3)
            and i.status in ('pending', 'blocked'))`)

    // גוגל מנותק → חובר מחדש.
    closed += await close('integration_disconnected', 'החיבור חודש', () => tx`
      update tasks t set status = 'done', notes = coalesce(t.notes, '') || ' · נסגר אוטומטית: החיבור חודש'
      where t.auto_generated and t.status <> 'done' and t.deleted_at is null
        and t.auto_key like 'integration_disconnected:%'
        and exists (select 1 from integrations i where i.provider = 'google' and i.status = 'connected')`)

    // ייבוא שבועי (WISE / חשבונית ירוקה) → נקלט אחרי שהמשימה נפתחה.
    for (const [prefix, source] of [['wise_import', 'wise_import'], ['greeninvoice_import', 'greeninvoice_import']] as const) {
      closed += await close(prefix, 'הייצוא נקלט', () => tx`
        update tasks t set status = 'done', notes = coalesce(t.notes, '') || ' · נסגר אוטומטית: הייצוא נקלט'
        where t.auto_generated and t.status <> 'done' and t.deleted_at is null
          and t.auto_key like ${`${prefix}:%`}
          and exists (
            select 1 from import_batches b
            where b.source = ${source} and b.deleted_at is null and b.created_at > t.created_at)`)
    }

    // אישור שכר → החודש אושר.
    closed += await close('payroll_approval', 'השכר אושר', () => tx`
      update tasks t set status = 'done', notes = coalesce(t.notes, '') || ' · נסגר אוטומטית: השכר אושר'
      where t.auto_generated and t.status <> 'done' and t.deleted_at is null
        and t.auto_key like 'payroll_approval:%'
        and not exists (
          select 1 from payroll_months m
          where m.period = split_part(t.auto_key, ':', 2) and m.deleted_at is null and m.status = 'draft')`)

    return { closed, byRule }
  })
}
