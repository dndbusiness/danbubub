-- ════════════════════════════════════════════════════════════════════════════
-- מסך 20 — גביה (ADDENDUM ב.6). כל דוח הוא view (SPEC §11).
-- ════════════════════════════════════════════════════════════════════════════

/*
 * v_deal_document_status — ב.6 "תפעול חשבוניות":
 *   לא הוצא → חשבונית מס הוצאה → שולם → קבלה הוצאה.
 * המערכת לא מנפיקה מסמכי מס; הסטטוס נגזר מ-invoices(direction='issued') ומהתקבולים.
 */
create or replace view v_deal_document_status as
select
  d.id                                   as deal_id,
  case
    when exists (select 1 from invoices i where i.deal_id = d.id and i.direction = 'issued'
                   and i.doc_type = 'receipt' and i.deleted_at is null)             then 'receipt_issued'
    when exists (select 1 from transactions t where t.deal_id = d.id and t.nature = 'income'
                   and t.certainty = 'actual' and t.deleted_at is null)             then 'paid'
    when exists (select 1 from invoices i where i.deal_id = d.id and i.direction = 'issued'
                   and i.deleted_at is null)                                        then 'invoice_issued'
    else 'not_issued'
  end                                    as document_status,
  (select max(i.date) from invoices i where i.deal_id = d.id and i.direction = 'issued' and i.deleted_at is null) as last_invoice_date
from deals d
where d.deleted_at is null;

/*
 * v_collections_ops — שורת מסך 20: הגיול (v_collections) + מסמך + הפעולה האחרונה
 * + הפריט הבא שחסר (ב.5), כדי שכל שורה תענה על "למה הכסף עוד לא נכנס".
 */
create or replace view v_collections_ops as
select
  c.deal_id, c.client_name, c.division, c.collection_status,
  c.open_amount, c.open_committed, c.open_expected,
  c.due_date, c.days_overdue, c.aging_bucket, c.stage, c.status,
  d.client_phone,
  u.full_name                                   as owner_name,
  u.email                                       as owner_email,
  ds.document_status,
  ds.last_invoice_date,
  ep.next_missing,
  ep.stuck_days,
  ep.completion_pct,
  la.kind                                       as last_action_kind,
  la.created_at                                 as last_action_at,
  la.channel                                    as last_action_channel
from v_collections c
join deals d on d.id = c.deal_id
left join users u on u.id = d.owner_user_id
left join v_deal_document_status ds on ds.deal_id = c.deal_id
left join v_execution_pipeline ep on ep.deal_id = c.deal_id
left join lateral (
  select a.kind, a.created_at, a.channel
  from collection_actions a
  where a.deal_id = c.deal_id and a.deleted_at is null
  order by a.created_at desc
  limit 1
) la on true;

comment on view v_collections_ops is
  'ADDENDUM ב.6 — מסך 20: גיול, מסמך, פעולה אחרונה, והפריט החוסם מ-ב.5.';

/*
 * v_collection_flags — שלושת הדגלים האוטומטיים של ב.6.
 * אותם ספים של lib/rules/collections.ts (7 / 30 יום), ובדיקת זהות ב-db/tests.
 */
create or replace view v_collection_flags as
-- תקבול בבנק ללא חשבונית מס תוך 7 ימים
select
  'receipt_without_invoice'                      as kind,
  'receipt_without_invoice:' || t.id::text       as rule_key,
  t.deal_id,
  t.id::text                                     as ref_id,
  coalesce(d.client_name, t.counterparty, 'לקוח') as subject,
  abs(t.amount_net)                              as amount,
  (current_date - t.date_cash)                   as days
from transactions t
left join deals d on d.id = t.deal_id
where t.nature = 'income' and t.certainty = 'actual' and t.deleted_at is null
  and t.invoice_status not in ('has_invoice', 'no_invoice_needed')
  and current_date - t.date_cash >= 7

union all

-- חשבונית מס שהוצאה ולא שולמה 30 יום
select
  'invoice_unpaid_30d',
  'invoice_unpaid:' || i.id::text,
  i.deal_id,
  i.id::text,
  coalesce(i.counterparty, 'לקוח'),
  abs(i.amount_gross),
  (current_date - i.date)
from invoices i
where i.direction = 'issued' and i.matched_tx_id is null and i.deleted_at is null
  and current_date - i.date >= 30

union all

-- תיק "הושלם" עם יתרה פתוחה
select
  'completed_deal_open_balance',
  'completed_open:' || c.deal_id::text,
  c.deal_id,
  c.deal_id::text,
  c.client_name,
  c.open_amount,
  c.days_overdue
from v_collections c
where c.stage in ('completed', 're_closed') and c.open_amount > 0;

comment on view v_collection_flags is
  'ADDENDUM ב.6 — שלושת הדגלים האוטומטיים. rule_key ייחודי (הנחיה 18).';
