-- ════════════════════════════════════════════════════════════════════════════
-- 012 — גביה (ADDENDUM ב.6): יומן פעולות הגביה
--
-- "לכל שורה: … פעולה אחרונה (תזכורת נשלחה ב-…), כפתורים: שלח תזכורת / סמן שולם /
--  העבר לטיפול משפטי." כל פעולה נרשמת כאן — כדי שאפשר יהיה לראות מה כבר נעשה,
--  ולמנוע הצפת הלקוח בתזכורות.
-- ════════════════════════════════════════════════════════════════════════════

-- ב.6 "תפעול חשבוניות": סטטוס המסמך הוא *לכל תיק*, ולכן חשבונית שהוצאה ללקוח
-- מקושרת לתיק. (חשבונית שהתקבלה מספק — ב.3 — נשארת בלי תיק.)
alter table invoices add column deal_id uuid references deals(id);
create index invoices_deal_idx on invoices (deal_id) where deal_id is not null and deleted_at is null;

create table collection_actions (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id),
  kind         text not null check (kind in ('reminder_sent', 'marked_paid', 'moved_to_legal', 'note', 'invoice_requested')),
  channel      text check (channel in ('whatsapp', 'email', 'phone', 'manual')),
  -- ההודעה כפי שנשלחה בפועל (ב.6 — מה נשלח ללקוח נשמר).
  message      text,
  amount       numeric(14,2),
  outbox_id    uuid references outbox(id),
  tx_id        uuid references transactions(id),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

create index collection_actions_deal_idx on collection_actions (deal_id, created_at desc) where deleted_at is null;

select install_standard_triggers('collection_actions');

comment on table collection_actions is
  'ADDENDUM ב.6 — יומן הגביה: תזכורות שנשלחו, סימוני תשלום, העברה לטיפול משפטי.';
