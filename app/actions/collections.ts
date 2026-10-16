'use server'

import { revalidatePath } from 'next/cache'
import { sql, withActor } from '@/lib/db'
import { buildCollectionReminder, toInternationalPhone } from '@/lib/rules/reminders'
import type { AgingBucket } from '@/lib/rules/collections'
import { enqueueOutbox, flushOutbox } from '@/lib/jobs/outbox'
import { settingValues } from '@/lib/queries/cashflow'
import { isPeriodLocked, vatRateOn } from '@/lib/queries/common'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

async function row(dealId: string) {
  const [r] = await sql<{ deal_id: string; client_name: string; client_phone: string | null; open_amount: number; due_date: string | null; days_overdue: number; aging_bucket: AgingBucket; document_status: string; division: string }[]>`
    select deal_id, client_name, client_phone, open_amount, to_char(due_date, 'YYYY-MM-DD') as due_date,
           days_overdue::int, aging_bucket, document_status, division
    from v_collections_ops where deal_id = ${dealId}`
  return r ?? null
}

/** UIUX §5.7 — preview לפני שליחה. אותה פונקציה טהורה שמייצרת את ההודעה שתישלח. */
export async function previewReminder(dealId: string): Promise<Result<{ whatsapp: string; emailHtml: string; subject: string; tone: string; phone: string | null; hasWhatsApp: boolean }>> {
  const r = await row(dealId)
  if (!r) return { ok: false, error: 'תיק לא נמצא ברשימת הגביה' }
  const s = await settingValues(['company_name'])
  const m = buildCollectionReminder({
    clientName: r.client_name, amount: r.open_amount, dueDate: r.due_date, daysOverdue: r.days_overdue,
    bucket: r.aging_bucket, invoiceIssued: r.document_status !== 'not_issued',
    companyName: typeof s.company_name === 'string' ? s.company_name : undefined,
  })
  const phone = toInternationalPhone(r.client_phone)
  return { ok: true, ...m, phone, hasWhatsApp: Boolean(phone && process.env.GREEN_API_ID_INSTANCE && process.env.GREEN_API_TOKEN) }
}

/** ב.6 — "שלח תזכורת". כל יציאה דרך outbox (הנחיה 16); הפעולה נרשמת ביומן הגביה. */
export async function sendReminder(dealId: string, channel: 'whatsapp' | 'email', messageOverride?: string): Promise<Result<{ queued: boolean; sent: boolean }>> {
  const preview = await previewReminder(dealId)
  if (!preview.ok) return preview
  const r = await row(dealId)
  if (!r) return { ok: false, error: 'תיק לא נמצא' }
  const target = channel === 'whatsapp' ? preview.phone : (await sql<{ email: string | null }[]>`select client_email as email from deals where id = ${dealId}`)[0]?.email ?? null
  if (!target) return { ok: false, error: channel === 'whatsapp' ? 'אין טלפון תקין ללקוח בתיק' : 'אין מייל ללקוח בתיק' }
  const body = messageOverride?.trim() || (channel === 'whatsapp' ? preview.whatsapp : preview.emailHtml)
  const dedupKey = `collect:${dealId}:${channel}:${new Date().toISOString().slice(0, 10)}`
  try {
    const queued = await enqueueOutbox([{ channel, target, subject: channel === 'email' ? preview.subject : null, body, dedupKey }])
    if (!queued) return { ok: false, error: 'כבר נשלחה תזכורת ללקוח הזה היום' }
    const [ob] = await sql<{ id: string }[]>`select id from outbox where dedup_key = ${dedupKey}`
    await withActor(async (tx) => {
      await tx`insert into collection_actions (deal_id, kind, channel, message, amount, outbox_id)
               values (${dealId}, 'reminder_sent', ${channel}, ${body}, ${r.open_amount}, ${ob?.id ?? null})`
    })
    const flush = await flushOutbox()
    revalidatePath('/collections')
    return { ok: true, queued: true, sent: flush.sent > 0 }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** ב.6 — "סמן שולם": שיוך תנועה קיימת לתיק, או יצירת תנועת תקבול. */
export async function markPaid(dealId: string, opts: { txId?: string; amount?: number; date?: string; accountId?: string }): Promise<Result<{ txId: string }>> {
  const r = await row(dealId)
  if (!r) return { ok: false, error: 'תיק לא נמצא' }
  try {
    const txId = await withActor(async (tx) => {
      if (opts.txId) {
        await tx`update transactions set deal_id = ${dealId} where id = ${opts.txId} and deleted_at is null`
        return opts.txId
      }
      const amount = opts.amount ?? r.open_amount
      const date = opts.date ?? new Date().toISOString().slice(0, 10)
      if (amount <= 0) return Promise.reject(new Error('סכום חייב להיות חיובי'))
      const [account] = await tx<{ id: string }[]>`select id from accounts where type = 'bank' and deleted_at is null and active order by created_at limit 1`
      const accountId = opts.accountId ?? account?.id
      if (!accountId) return Promise.reject(new Error('אין חשבון בנק פעיל'))
      const vatRate = await vatRateOn(date)
      const [created] = await tx<{ id: string }[]>`
        insert into transactions (date_cash, account_id, amount_net, vat_mode, vat_rate, nature, division, deal_id, counterparty, description, invoice_status, source)
        values (${date}, ${accountId}, ${Math.abs(amount)}, 'excl', ${vatRate}, 'income', ${r.division}, ${dealId}, ${r.client_name},
                ${`תקבול שכ"ט — ${r.client_name}`}, ${r.document_status === 'not_issued' ? 'missing' : 'has_invoice'}, 'manual')
        returning id`
      return created!.id
    })
    await withActor(async (tx) => {
      await tx`insert into collection_actions (deal_id, kind, channel, amount, tx_id, note)
               values (${dealId}, 'marked_paid', 'manual', ${opts.amount ?? r.open_amount}, ${txId}, ${opts.txId ? 'שויכה תנועה קיימת' : 'נוצרה תנועת תקבול'})`
      // אם נסגרה היתרה — סטטוס הגביה מתעדכן.
      await tx`
        update deals d set collection_status = case
          when (select coalesce(sum(t.amount_net), 0) from transactions t where t.deal_id = d.id and t.nature = 'income' and t.certainty = 'actual' and t.deleted_at is null) >= d.fee_agreed_net
          then 'fully_paid' else 'partially_paid' end
        where d.id = ${dealId} and d.collection_status not in ('legal_collection', 'cancelled')`
    })
    revalidatePath('/collections'); revalidatePath('/deals'); revalidatePath(`/deals/${dealId}`); revalidatePath('/transactions')
    return { ok: true, txId }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

export async function moveToLegal(dealId: string, note?: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update deals set collection_status = 'legal_collection' where id = ${dealId} and deleted_at is null`
      await tx`insert into collection_actions (deal_id, kind, channel, note) values (${dealId}, 'moved_to_legal', 'manual', ${note ?? null})`
      await tx`insert into tasks (title, due_date, priority, auto_generated, auto_key, deal_id, notes)
               values (${`טיפול משפטי — ${(await tx<{ n: string }[]>`select client_name as n from deals where id = ${dealId}`)[0]?.n ?? ''}`},
                       current_date + 3, 'high', true, ${`legal_collection:${dealId}`}, ${dealId}, ${note ?? null})
               on conflict do nothing`
    })
    revalidatePath('/collections'); revalidatePath('/deals')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/**
 * ב.6 — "הוצא חשבונית": **המערכת לא מנפיקה מסמכי מס.** פותחת את חשבונית ירוקה
 * עם הלקוח והסכום, ורושמת שהתבקשה — הסטטוס יתעדכן לבד בייבוא הבא (4.3).
 */
export async function requestInvoice(dealId: string): Promise<Result<{ url: string }>> {
  const r = await row(dealId)
  if (!r) return { ok: false, error: 'תיק לא נמצא' }
  const s = await settingValues(['greeninvoice_new_doc_url'])
  const base = typeof s.greeninvoice_new_doc_url === 'string' ? s.greeninvoice_new_doc_url : 'https://app.greeninvoice.co.il/documents/new'
  const url = `${base}${base.includes('?') ? '&' : '?'}client=${encodeURIComponent(r.client_name)}&amount=${Math.round(r.open_amount)}`
  try {
    await withActor(async (tx) => {
      await tx`insert into collection_actions (deal_id, kind, channel, amount, note) values (${dealId}, 'invoice_requested', 'manual', ${r.open_amount}, ${url})`
    })
    revalidatePath('/collections')
    return { ok: true, url }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** בדיקה שהחודש לא נעול לפני "סמן שולם" בתאריך ישן. */
export async function canPostOn(date: string, division: 'finance' | 'realestate'): Promise<boolean> {
  return !(await isPeriodLocked(date.slice(0, 7), division))
}
