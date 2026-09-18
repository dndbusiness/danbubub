-- ════════════════════════════════════════════════════════════════════════════
-- 004 — התחשבנות: לוח תקבולים, מקדמות, משיכות, חשבוניות
-- SPEC §2.1, §3.3, §3.5, §4.3
-- ════════════════════════════════════════════════════════════════════════════

-- SPEC §2.1 — "כל שורה נושאת את הודאות שלה בנפרד."
-- זה מה שמאפשר "שולם חלקית ויש יתרה — פוטנציאלית או בטוחה לכאורה".
create table deal_payments_plan (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references deals(id),
  label          text not null,
  amount_net     numeric(14,2) not null,
  expected_date  date not null,
  certainty      certainty_level not null
                   check (certainty in ('committed', 'expected')),
  probability    numeric(4,3) not null default 1
                   check (probability between 0 and 1),
  matched_tx_id  uuid references transactions(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references users(id),
  deleted_at     timestamptz,
  -- committed הוא ודאי בהגדרה.
  constraint committed_is_certain
    check (certainty <> 'committed' or probability = 1)
);

create index dpp_deal_idx on deal_payments_plan (deal_id) where deleted_at is null;
create index dpp_open_idx on deal_payments_plan (expected_date)
  where matched_tx_id is null and deleted_at is null;

-- SPEC §2.1 — מקדמות לניסים. נרשמות בברוטו (שאלה פתוחה #4).
create table advances (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  amount_gross   numeric(14,2) not null check (amount_gross > 0),
  method         text not null check (method in ('cash', 'credit_card', 'transfer')),
  tx_id          uuid references transactions(id),
  -- חודש הקיזוז. חובה — מקדמה בלי חודש חוסמת סגירה (SPEC §3.3 שלב 2).
  period         char(7) not null check (period ~ '^\d{4}-\d{2}$'),
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references users(id),
  deleted_at     timestamptz
);

create index advances_period_idx on advances (period) where deleted_at is null;

comment on table advances is
  'SPEC §3.3 — המקדמה היא הדבר היחיד שיורד רק מחלקו של ניסים.
   הוצאות קבועות מאושרות מתקזזות מהרווח *לפני* החלוקה.';

-- SPEC §2.1, §3.5 — משיכות שותפים.
create table partner_draws (
  id                     uuid primary key default gen_random_uuid(),
  date                   date not null,
  partner_id             uuid not null references partners(id),
  amount                 numeric(14,2) not null,
  type                   text not null check (type in (
                           'salary', 'management_fee', 'dividend',
                           'loan_repayment', 'owner_loan'
                         )),
  tx_id                  uuid references transactions(id),
  -- SPEC §3.5 — יוני: עלות התלוש כולל עלות מעביד היא מה שנספר כמשיכה.
  includes_employer_cost boolean not null default false,
  note                   text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references users(id),
  deleted_at             timestamptz
);

create index partner_draws_idx on partner_draws (partner_id, date desc)
  where deleted_at is null;

-- SPEC §2.1 — מסמכים, יוצאים ונכנסים.
create table suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- SPEC §4.3 — "אותו ספק מופיע בכתיבים שונים". ההתאמה לבנק לפי ספק מנורמל.
  aliases       text[] not null default '{}',
  category_id   uuid references categories(id),
  -- SPEC §4.3 — ספק ∈ {די.אנד.די, אביב, ניסים} → nature=draw, דורש אישור.
  is_partner_entity boolean not null default false,
  partner_id    uuid references partners(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references users(id),
  deleted_at    timestamptz
);

create unique index suppliers_name_unique on suppliers (lower(name))
  where deleted_at is null;

create table invoices (
  id               uuid primary key default gen_random_uuid(),
  direction        text not null check (direction in ('issued', 'received')),
  doc_type         text not null,
  doc_number       text,
  date             date not null,
  counterparty     text,
  supplier_id      uuid references suppliers(id),
  amount_net       numeric(14,2) not null,
  vat_amount       numeric(14,2) not null default 0,
  amount_gross     numeric(14,2) not null,
  entity_id        uuid references entities(id),
  matched_tx_id    uuid references transactions(id),
  -- SPEC §4.3 — "חודש דיווח ≠ חודש המסמך לפעמים — זה חודש המע"מ".
  vat_period       char(7) check (vat_period ~ '^\d{4}-\d{2}$'),
  -- SPEC §4.3 — סטטוס בחשבונית ירוקה: "הוצאה מדווחת" / "הוצאה פתוחה".
  reported         boolean not null default false,
  -- SPEC §4.3 — כפילויות בקובץ האמיתי מסומנות ולא מיובאות פעמיים בלי אישור.
  possible_duplicate boolean not null default false,
  source           tx_source not null default 'manual',
  source_ref       text,
  file_url         text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references users(id),
  deleted_at       timestamptz
);

-- SPEC §4.3 — מפתח dedup: (מספר מסמך, ספק, סכום כולל).
create unique index invoices_dedup
  on invoices (doc_number, lower(coalesce(counterparty, '')), amount_gross)
  where doc_number is not null and deleted_at is null;

create index invoices_unmatched_idx on invoices (direction, date)
  where matched_tx_id is null and deleted_at is null;

alter table transactions
  add constraint transactions_invoice_fk
  foreign key (invoice_id) references invoices(id);

alter table periods
  add constraint periods_settlement_tx_fk
  foreign key (settlement_transfer_tx_id) references transactions(id);

-- SPEC §2.1 — הכנסות פרייבט. אזור מוגן.
-- "טבלה זו לא מצטרפת לשום שאילתה של transactions."
create table private_income (
  id              uuid primary key default gen_random_uuid(),
  fund_name       text not null,
  deal_ref        text,
  deal_amount     numeric(14,2),
  threshold_rule  jsonb,
  pct             numeric(6,4),
  amount_net      numeric(14,2) not null,
  vat_amount      numeric(14,2) not null default 0,
  split_dan       numeric(4,3) not null default 0.5,
  split_nissim    numeric(4,3) not null default 0.5,
  received_date   date,
  received_to     text,
  status          text not null default 'expected'
                    check (status in ('expected', 'received')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references users(id),
  deleted_at      timestamptz,
  constraint private_split_sums_to_one
    check (abs(split_dan + split_nissim - 1) < 0.001)
);

comment on table private_income is
  'SPEC §2.1 — נפרד לחלוטין מהחברה. אם הכסף נחת בטעות בחשבון החברה,
   נרשם כ-transfer החוצה ומסומן. לא נכנס לחישוב מע"מ החברה (§3.1).';

select install_standard_triggers('deal_payments_plan');
select install_standard_triggers('advances');
select install_standard_triggers('partner_draws');
select install_standard_triggers('suppliers');
select install_standard_triggers('invoices');
select install_standard_triggers('private_income');
