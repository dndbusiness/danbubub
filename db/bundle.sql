-- ══════════════════════════════════════════════════════════════════════════
-- מערכת הכספים של הר-אל — סכימה מלאה בקובץ אחד.
-- נוצר אוטומטית מ-23 קבצים ע"י scripts/build-sql-bundle.mjs. אין לערוך כאן.
-- להדביק ב-SQL editor של בסיס הנתונים ולהריץ פעם אחת. ריצה חוזרת בטוחה:
-- הטבלאות נוצרות פעם אחת, ה-views וה-seed מתעדכנים.
-- ══════════════════════════════════════════════════════════════════════════

-- ─── db/schema/001_foundation.sql ──────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 001 — יסודות: טיפוסים, הגדרות, משתמשים, יומן שינויים
-- SPEC §2.1, §11.4, §11.5
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

-- ── רשימות סגורות (SPEC §2.3) ───────────────────────────────────────────────
-- הן ENUM ולא טקסט חופשי: רשימה סגורה שנאכפת ב-DB היא מה שמונע את
-- "הוצאה בלי קטגוריה" ואת "סטטוס שלא קיים" (נספח ב, ליקוי #7).

create type tx_nature as enum (
  'income', 'expense', 'financing', 'transfer', 'advance', 'draw', 'vat', 'tax'
);

create type tx_division as enum ('realestate', 'finance', 'shared', 'private');

create type concrete_division as enum ('realestate', 'finance');

create type vat_mode as enum ('excl', 'incl', 'exempt');

create type certainty_level as enum ('actual', 'committed', 'expected');

create type tx_class as enum ('business', 'vehicle', 'private');

create type invoice_status as enum (
  'has_invoice', 'missing', 'no_invoice_needed', 'unknown'
);

create type review_status as enum (
  'ok', 'ask_nissim', 'ask_aviv', 'ask_yoni', 'unknown_expense'
);

create type category_kind as enum ('fixed', 'direct', 'variable', 'owner');

create type period_status as enum ('open', 'closed');

create type user_role as enum (
  'admin', 'partner_finance', 'partner_realestate', 'backoffice', 'accountant'
);

create type pay_type as enum ('payslip', 'invoice', 'freelancer');

create type entity_type as enum ('company', 'sole_proprietor');

create type account_type as enum ('bank', 'credit_card', 'cash', 'loan');

create type deal_status as enum ('open', 'won', 'lost', 'cancelled');

create type collection_status as enum (
  'not_collected', 'advance_paid', 'partially_paid',
  'fully_paid', 'legal_collection', 'cancelled'
);

create type lead_stage as enum (
  'received', 'contacted', 'meeting', 'proposal', 'signed', 'closed_won', 'closed_lost'
);

create type tx_source as enum (
  'manual', 'card_import', 'bank_import', 'greeninvoice_import', 'wise_import', 'system'
);

-- ── משתמשים ─────────────────────────────────────────────────────────────────

create table users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  full_name    text not null,
  role         user_role not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

comment on table users is 'SPEC §2.1 — role קובע גם RLS לפי division.';

-- ── הגדרות (SPEC §5 מסך 18) ─────────────────────────────────────────────────
-- זוג מפתח/ערך אחד, כי ההגדרות נקראות תמיד יחד ומשתנות נדיר.

create table settings (
  key          text primary key,
  value        jsonb not null,
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references users(id)
);

-- SPEC §3.1 — היסטוריה של שיעורי מע"מ לפי תאריך.
create table vat_rates (
  id           uuid primary key default gen_random_uuid(),
  valid_from   date not null unique,
  rate         numeric(5,4) not null check (rate >= 0 and rate < 1),
  created_at   timestamptz not null default now()
);

-- ── יומן שינויים (SPEC §1.7, §11.4) ─────────────────────────────────────────

create table audit_log (
  id           bigserial primary key,
  table_name   text not null,
  row_id       text not null,
  action       text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_value    jsonb,
  new_value    jsonb,
  changed_by   uuid references users(id),
  changed_at   timestamptz not null default now()
);

create index audit_log_row_idx on audit_log (table_name, row_id, changed_at desc);
create index audit_log_actor_idx on audit_log (changed_by, changed_at desc);

comment on table audit_log is
  'SPEC §1.7 — כל יצירה/עריכה/מחיקה: מי, מתי, ערך קודם, ערך חדש.';

-- ── תשתית לטריגרים ──────────────────────────────────────────────────────────

-- המשתמש הפועל. Supabase מציב אותו דרך auth.uid(); בייבוא/cron מציבים ידנית
-- עם  set_config('app.current_user_id', …).
create or replace function current_actor() returns uuid
language plpgsql stable as $$
declare
  v text;
begin
  v := nullif(current_setting('app.current_user_id', true), '');
  if v is null then return null; end if;
  return v::uuid;
exception when others then
  return null;
end;
$$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function write_audit_log() returns trigger
language plpgsql security definer as $$
declare
  row_identifier text;
begin
  row_identifier := coalesce(
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
    '?'
  );

  insert into audit_log (table_name, row_id, action, old_value, new_value, changed_by)
  values (
    tg_table_name,
    row_identifier,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    current_actor()
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- SPEC §11.4: "אין DELETE פיזי — soft delete."
create or replace function block_hard_delete() returns trigger
language plpgsql as $$
begin
  raise exception
    'מחיקה פיזית אסורה בטבלה % (SPEC §11.4). השתמשו ב-UPDATE … SET deleted_at = now().',
    tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- מחיל את שלושת הטריגרים על טבלה. נקרא בסוף כל קובץ סכימה.
create or replace function install_standard_triggers(target regclass) returns void
language plpgsql as $$
declare
  t text := target::text;
begin
  execute format(
    'create trigger %I before update on %s for each row execute function touch_updated_at()',
    't_touch_' || replace(t, '.', '_'), t
  );
  execute format(
    'create trigger %I after insert or update or delete on %s
       for each row execute function write_audit_log()',
    't_audit_' || replace(t, '.', '_'), t
  );
  execute format(
    'create trigger %I before delete on %s for each row execute function block_hard_delete()',
    't_nodelete_' || replace(t, '.', '_'), t
  );
end;
$$;

select install_standard_triggers('users');

-- ─── db/schema/002_core.sql ────────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 002 — ישויות, חשבונות, עוגן יומי, קטגוריות, תקופות
-- SPEC §2.1, §2.2
-- ════════════════════════════════════════════════════════════════════════════

create table entities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         entity_type not null,
  vat_id       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

comment on table entities is
  'SPEC §2.2 — שלוש ישויות משפטיות בחשבון אחד: א.ד.י הראל השקעות, D&D, עדן הובלות ובנייה.';

create table accounts (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references entities(id),
  type              account_type not null,
  name              text not null,
  -- SPEC §2.1 — לכרטיס אשראי: יום החיוב (2 / 10 / 15).
  billing_day       smallint check (billing_day between 1 and 31),
  credit_limit      numeric(14,2),
  default_division  tx_division not null default 'finance',
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references users(id),
  deleted_at        timestamptz,
  constraint billing_day_only_for_cards
    check (billing_day is null or type = 'credit_card')
);

comment on column accounts.default_division is
  'SPEC §2.2 — כשתבוצע הפרדת חשבונות, מוסיפים חשבון ומשנים כאן. שום דוח לא משתנה.';

-- SPEC §2.1 `balances` — עוגן יומי. SPEC §6: יתרת הבנק היא אדמין בלבד.
create table balances (
  id                uuid primary key default gen_random_uuid(),
  date              date not null,
  account_id        uuid not null references accounts(id),
  balance           numeric(14,2) not null,
  available_credit  numeric(14,2),
  source            text not null default 'manual'
                      check (source in ('manual', 'statement_import')),
  entered_by        uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references users(id),
  deleted_at        timestamptz,
  -- עוגן אחד ליום לכל חשבון; הזנה חוזרת מעדכנת ולא מוסיפה.
  unique (account_id, date)
);

create index balances_date_idx on balances (date desc);

-- SPEC §2.1 — עץ קטגוריות.
create table categories (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references categories(id),
  name         text not null,
  kind         category_kind not null,
  -- SPEC §4.3 — מפתח חשבון בחשבונית ירוקה (3011 שכר, 3540 הנה"ח, …).
  gi_account_key text,
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz,
  constraint category_not_own_parent check (parent_id is null or parent_id <> id)
);

create unique index categories_name_unique
  on categories (name) where deleted_at is null;

comment on column categories.gi_account_key is
  'SPEC §4.3 — הפלט לרו"ח ממפה כל קטגוריה למפתח חשבון של חשבונית ירוקה.';

-- SPEC §2.1 `periods` — תקופות התחשבנות ונעילה.
create table periods (
  id                        uuid primary key default gen_random_uuid(),
  division                  concrete_division not null,
  year                      int not null check (year between 2020 and 2100),
  month                     int not null check (month between 1 and 12),
  status                    period_status not null default 'open',
  -- SPEC §3.3 "מנקים שולחן" — יתרת פתיחה מוזנת ידנית פעם אחת.
  opening_balance           numeric(14,2),
  -- SPEC §2.1 — תצלום כל המספרים ברגע הסגירה. לא מחושב מחדש אחר כך.
  snapshot_json             jsonb,
  settlement_transfer_tx_id uuid,
  closed_at                 timestamptz,
  closed_by                 uuid references users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references users(id),
  deleted_at                timestamptz,
  unique (division, year, month),
  constraint closed_period_has_snapshot
    check (status = 'open' or (closed_at is not null and snapshot_json is not null))
);

comment on constraint closed_period_has_snapshot on periods is
  'SPEC §1.6 + §2.1 — תקופה סגורה בלי תצלום היא מספר שאפשר לשחזר אחרת מאוחר יותר.';

-- SPEC §2.1 — שותפים.
create table partners (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id),
  name         text not null,
  division     concrete_division not null,
  share_pct    numeric(6,5) not null check (share_pct > 0 and share_pct <= 1),
  pay_method   text not null check (pay_method in ('invoice', 'payslip')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

-- SPEC §3.5 — חוב יוני 200,000 ₪: יתרת פתיחה שיורדת בהחזרים.
create table owner_loans (
  id                uuid primary key default gen_random_uuid(),
  partner_id        uuid not null references partners(id),
  opening_balance   numeric(14,2) not null,
  opening_date      date not null,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references users(id),
  deleted_at        timestamptz
);

select install_standard_triggers('entities');
select install_standard_triggers('accounts');
select install_standard_triggers('balances');
select install_standard_triggers('categories');
select install_standard_triggers('periods');
select install_standard_triggers('partners');
select install_standard_triggers('owner_loans');

-- ─── db/schema/003_transactions.sql ────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 003 — transactions: הטבלה המרכזית
-- SPEC §1.1 "מקור אמת אחד", §2.1, §11.5, §11.8
-- ════════════════════════════════════════════════════════════════════════════

create table fixed_expenses (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  category_id         uuid not null references categories(id),
  division            tx_division not null,
  division_split      jsonb,
  amount_net          numeric(14,2) not null,
  vat_mode            vat_mode not null default 'excl',
  frequency           text not null
                        check (frequency in ('monthly', 'quarterly', 'yearly', 'once')),
  day_of_month        smallint not null check (day_of_month between 1 and 31),
  account_id          uuid not null references accounts(id),
  -- סכום משתנה (אשראי) לעומת קבוע (שכירות).
  variable            boolean not null default false,
  -- SPEC §3.3 — "הוצאה קבועה מאושרת" ל-50/50.
  approved_by_nissim  boolean not null default false,
  approved_by         uuid references users(id),
  approved_at         timestamptz,
  start_date          date not null,
  end_date            date,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references users(id),
  deleted_at          timestamptz,
  constraint fixed_expense_dates check (end_date is null or end_date >= start_date),
  constraint shared_needs_split
    check (division <> 'shared' or division_split is not null)
);

comment on table fixed_expenses is
  'SPEC §2.1 — מהטבלה הזו נולדות שורות expected בתזרים 13 שבועות.';

-- ── deals ───────────────────────────────────────────────────────────────────

create table deals (
  id                        uuid primary key default gen_random_uuid(),
  client_name               text not null,
  client_phone              text,
  client_email              text,
  division                  concrete_division not null,
  product                   text not null,
  stage                     text not null,
  collection_status         collection_status not null default 'not_collected',
  fee_agreed_net            numeric(14,2) not null default 0,
  fee_mode                  text not null default 'fixed'
                              check (fee_mode in ('fixed', 'pct_of_credit', 'pct_of_property')),
  fee_pct                   numeric(6,4),
  base_amount               numeric(14,2),
  advance_at_signing_net    numeric(14,2),
  -- SPEC §2.1 — נדל"ן בלבד, net-30, אחרי ניכוי מס במקור.
  developer_commission_net  numeric(14,2),
  opening_fee_net           numeric(14,2),
  expected_close_date       date,
  probability_override      numeric(4,3) check (probability_override between 0 and 1),
  lead_source_id            uuid,
  -- SPEC §3.4 — חודש ההתחשבנות. NULL = ייגזר מהתקבול הראשון.
  month_attributed          char(7) check (month_attributed ~ '^\d{4}-\d{2}$'),
  owner_user_id             uuid references users(id),
  closer_id                 uuid references users(id),
  status                    deal_status not null default 'open',
  -- SPEC §2.1 — 2,000 ₪ במקרה ביטול אחרי יום עסקים.
  cancelled_fee_net         numeric(14,2),
  signed_at                 date,
  last_activity_at          timestamptz,
  -- SPEC §4.5 — מפתח שידוך לייבוא מ-WISE, idempotent.
  wise_ref                  text,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references users(id),
  deleted_at                timestamptz,
  constraint fee_pct_needs_base
    check (fee_mode = 'fixed' or (fee_pct is not null and base_amount is not null))
);

create unique index deals_wise_ref_unique on deals (wise_ref) where wise_ref is not null;
create index deals_month_idx on deals (month_attributed) where deleted_at is null;
create index deals_status_idx on deals (division, status) where deleted_at is null;

-- ── transactions ────────────────────────────────────────────────────────────

create table transactions (
  id                uuid primary key default gen_random_uuid(),

  -- מתי הכסף זז בפועל. זהו התאריך שכל דוח תזרים נשען עליו.
  date_cash         date not null,
  -- תאריך חשבונית/מסמך. משמש לשיוך תקופת מע"מ.
  date_doc          date,

  account_id        uuid not null references accounts(id),

  -- SPEC §2.1 — חתום: חיובי נכנס, שלילי יוצא. SPEC §11.5 — NUMERIC, לא float.
  amount_net        numeric(14,2) not null,
  vat_mode          vat_mode not null default 'excl',
  vat_rate          numeric(5,4) not null default 0.18,
  -- SPEC §11.5 — "מע"מ מחושב פעם אחת בכתיבה ונשמר". הטריגר למטה כותב אותם.
  vat_amount        numeric(14,2) not null default 0,
  amount_gross      numeric(14,2) not null default 0,

  nature            tx_nature not null,
  division          tx_division not null,
  division_split    jsonb,

  category_id       uuid references categories(id),
  tx_class          tx_class not null default 'business',
  -- "מוכרת לפעילות" — קובע אם נכנסת לרווח לחלוקה.
  deductible        boolean,

  fixed_expense_id  uuid references fixed_expenses(id),
  deal_id           uuid references deals(id),
  partner_id        uuid references partners(id),

  counterparty      text,
  description       text,

  -- SPEC §2.1 — בטבלה הזו תמיד actual. צפי יושב ב-fixed_expenses / deal_payments_plan.
  certainty         certainty_level not null default 'actual',

  -- SPEC §2.1 — לפירוט כרטיס אשראי: הבנות מצביעות על חיוב-האב.
  parent_id         uuid references transactions(id),

  invoice_status    invoice_status not null default 'unknown',
  invoice_id        uuid,
  review_status     review_status not null default 'ok',
  review_note       text,

  period_id         uuid references periods(id),

  source            tx_source not null default 'manual',
  -- SPEC §11.9 — ייבוא idempotent: dedup לפי המזהה במקור.
  source_ref        text,

  -- SPEC §3.5 — נכיון מזומן מוצג בנפרד בדוח, לא מוסתר.
  cash_discount     boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references users(id),
  deleted_at        timestamptz,

  -- ── אילוצים מ-SPEC §2.1 ──────────────────────────────────────────────────

  -- §1.2 — shared חייב מפתח חלוקה.
  constraint tx_shared_needs_split
    check (division <> 'shared' or division_split is not null),

  -- §2.1 — nature=advance חייב division=finance.
  constraint tx_advance_is_finance
    check (nature <> 'advance' or division = 'finance'),

  -- §2.1 — nature=draw חייב שותף.
  constraint tx_draw_needs_partner
    check (nature <> 'draw' or partner_id is not null),

  -- §2.1 — category_id חובה להוצאות.
  constraint tx_expense_needs_category
    check (nature <> 'expense' or category_id is not null),

  -- §3.2 — deductible חובה להוצאות, כי הוא קובע כניסה לרווח לחלוקה.
  constraint tx_expense_needs_deductible
    check (nature <> 'expense' or deductible is not null),

  -- §2.1 — שורה לא יכולה להיות אב של עצמה.
  constraint tx_not_own_parent check (parent_id is null or parent_id <> id),

  -- §2.1 — בטבלה הזו רק תנועות בפועל.
  constraint tx_is_actual check (certainty = 'actual'),

  -- הסימן חייב להתאים לטבע התנועה: הכנסה נכנסת, הוצאה יוצאת.
  constraint tx_income_is_positive check (nature <> 'income' or amount_net >= 0),
  constraint tx_expense_is_negative check (nature <> 'expense' or amount_net <= 0)
);

create unique index tx_source_ref_unique
  on transactions (account_id, source, source_ref)
  where source_ref is not null and deleted_at is null;

create index tx_date_idx on transactions (date_cash desc) where deleted_at is null;
create index tx_division_idx on transactions (division, nature, date_cash) where deleted_at is null;
create index tx_deal_idx on transactions (deal_id) where deal_id is not null and deleted_at is null;
create index tx_parent_idx on transactions (parent_id) where parent_id is not null;
create index tx_review_idx on transactions (review_status)
  where review_status <> 'ok' and deleted_at is null;
create index tx_missing_invoice_idx on transactions (invoice_status, date_cash)
  where invoice_status in ('missing', 'unknown') and deleted_at is null;

comment on table transactions is
  'SPEC §1.1 — הטבלה היחידה שמתעדת כסף שזז. כל השאר נגזר.';

-- ── מע"מ מחושב פעם אחת בכתיבה (SPEC §11.5) ──────────────────────────────────

create or replace function compute_tx_vat() returns trigger
language plpgsql as $$
begin
  if new.vat_mode = 'exempt' then
    new.vat_amount   := 0;
    new.amount_gross := new.amount_net;

  elsif new.vat_mode = 'excl' then
    -- amount_net הוא הנטו; המע"מ מתווסף מעליו.
    new.vat_amount   := round(new.amount_net * new.vat_rate, 2);
    new.amount_gross := new.amount_net + new.vat_amount;

  else -- 'incl': amount_net התקבל כברוטו וצריך להתפרק.
    new.amount_gross := new.amount_net;
    new.amount_net   := round(new.amount_gross / (1 + new.vat_rate), 2);
    new.vat_amount   := new.amount_gross - new.amount_net;
  end if;

  return new;
end;
$$;

comment on function compute_tx_vat is
  'SPEC §1.4 — המערכת שומרת תמיד amount_net, amount_gross ו-vat_amount.
   זהו אותו חישוב שב-lib/rules/vat.ts computeVat, ובדיקות היחידה מגנות על שניהם.';

create trigger t_tx_vat
  before insert or update of amount_net, vat_mode, vat_rate on transactions
  for each row execute function compute_tx_vat();

-- ── נעילת תקופה ברמת ה-DB (SPEC §11.8) ──────────────────────────────────────

create or replace function tx_division_for_lock(d tx_division) returns concrete_division
language sql immutable as $$
  select case
    when d = 'realestate' then 'realestate'::concrete_division
    else 'finance'::concrete_division
  end;
$$;

create or replace function enforce_period_lock() returns trigger
language plpgsql as $$
declare
  affected_date date;
  affected_division tx_division;
  locked_count int;
begin
  affected_date := coalesce(new.date_cash, old.date_cash);
  affected_division := coalesce(new.division, old.division);

  -- private אינה שייכת לשום תקופת התחשבנות עסקית.
  if affected_division = 'private' then
    return coalesce(new, old);
  end if;

  select count(*) into locked_count
  from periods p
  where p.status = 'closed'
    and p.deleted_at is null
    and p.year  = extract(year  from affected_date)::int
    and p.month = extract(month from affected_date)::int
    and (
      p.division = tx_division_for_lock(affected_division)
      -- shared נוגעת בשתי הפעילויות: נעילה של אחת מהן מספיקה.
      or (affected_division = 'shared')
    );

  if locked_count > 0 then
    raise exception
      'התקופה % נעולה (SPEC §1.6). תיקון נעשה בתנועת תיקון בתקופה הפתוחה, לא בעריכת העבר.',
      to_char(affected_date, 'MM/YYYY')
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger t_tx_period_lock
  before insert or update on transactions
  for each row execute function enforce_period_lock();

select install_standard_triggers('fixed_expenses');
select install_standard_triggers('deals');
select install_standard_triggers('transactions');

-- ─── db/schema/004_settlement.sql ──────────────────────────────────────
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

-- ─── db/schema/005_leads_payroll_ops.sql ───────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 005 — לידים, שכר, תפעול
-- SPEC §2.1, §3.8, §3.9, §4.4, §4.5
-- ════════════════════════════════════════════════════════════════════════════

-- ── לידים (SPEC §2.1, §3.8) ─────────────────────────────────────────────────

create table lead_sources (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  cost_model   text not null check (cost_model in ('per_lead', 'monthly', 'pct')),
  unit_cost    numeric(14,2),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

create unique index lead_sources_name_unique on lead_sources (lower(name))
  where deleted_at is null;

alter table deals
  add constraint deals_lead_source_fk
  foreign key (lead_source_id) references lead_sources(id);

create table leads (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  source_id      uuid not null references lead_sources(id),
  product        text not null,
  stage          lead_stage not null default 'received',
  name           text,
  phone          text,
  email          text,
  deal_id        uuid references deals(id),
  -- SPEC §4.5 — ייבוא idempotent מ-WISE לפי טלפון נייד (+ אימייל).
  wise_ref       text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references users(id),
  deleted_at     timestamptz
);

create unique index leads_wise_ref_unique on leads (wise_ref) where wise_ref is not null;
create index leads_week_idx on leads (date, source_id) where deleted_at is null;

create table lead_costs (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  source_id    uuid not null references lead_sources(id),
  amount       numeric(14,2) not null,
  tx_id        uuid references transactions(id),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

comment on table lead_costs is
  'SPEC נספח ב ליקוי #6 — עלויות הלידים הן תנועות בפועל, לא מספר ידני.
   חבילות (200 ₪/ליד ב-~2.5 חודשים) נפרסות לשורות שבועיות בייבוא.';

-- SPEC §4.5 — הגשות לבנקים, מיובאות מ-WISE. מזינות את ההסתברות.
create table deal_submissions (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references deals(id),
  bank           text not null,
  branch         text,
  submitted_at   date,
  status         text,
  approved_at    date,
  wise_ref       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references users(id),
  deleted_at     timestamptz
);

create unique index deal_submissions_wise_ref_unique
  on deal_submissions (wise_ref) where wise_ref is not null;

-- ── שכר (SPEC §2.1, §3.9) ───────────────────────────────────────────────────

create table employees (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  national_id     text,
  pay_type        pay_type not null,
  -- SPEC §1.2 — הדס: 80% מימון / 20% נדל"ן.
  division_split  jsonb not null,
  user_id         uuid references users(id),
  start_date      date not null,
  end_date        date,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references users(id),
  deleted_at      timestamptz
);

-- SPEC §3.9 — "שינוי הסכם = שורה חדשה, לא עריכה."
create table employment_terms (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references employees(id),
  valid_from         date not null,
  valid_to           date,
  base_mode          text not null check (base_mode in ('hourly', 'monthly', 'none')),
  hourly_rate        numeric(10,2),
  monthly_base       numeric(14,2),
  expected_hours     numeric(8,2),
  -- רשימת רכיבי בונוס: {name, type, rate, unit, cap, floor, tiers, threshold}
  components         jsonb not null default '[]',
  employer_cost_pct  numeric(5,4) not null default 0.22,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references users(id),
  deleted_at         timestamptz,
  constraint terms_dates check (valid_to is null or valid_to >= valid_from),
  constraint terms_base_has_rate check (
    (base_mode = 'hourly'  and hourly_rate  is not null) or
    (base_mode = 'monthly' and monthly_base is not null) or
    base_mode = 'none'
  )
);

-- תקופות התוקף של אותו עובד לא חופפות — אחרת החישוב כפול.
create index employment_terms_employee_idx on employment_terms (employee_id, valid_from);

alter table employment_terms add constraint employment_terms_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  ) where (deleted_at is null);

create table payroll_months (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id),
  period              char(7) not null check (period ~ '^\d{4}-\d{2}$'),
  hours_worked        numeric(8,2),
  meetings_count      int,
  sales_count         int,
  leads_count         int,
  sales_amount_net    numeric(14,2),
  manual_adjustments  jsonb not null default '[]',
  -- SPEC §3.9 — תצלום: כל רכיב + סכום + הסבר החישוב.
  computed            jsonb,
  gross_total         numeric(14,2),
  employer_cost_est   numeric(14,2),
  status              text not null default 'draft'
                        check (status in ('draft', 'approved', 'sent_to_accountant', 'paid')),
  approved_by         uuid references users(id),
  approved_at         timestamptz,
  paid_tx_id          uuid references transactions(id),
  report_file_url     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references users(id),
  deleted_at          timestamptz,
  unique (employee_id, period),
  constraint approved_has_snapshot
    check (status = 'draft' or computed is not null)
);

comment on constraint approved_has_snapshot on payroll_months is
  'SPEC §3.9 — "אין עריכה של חודש approved; תיקון = manual_adjustment בחודש הבא."
   התצלום הוא מה שנשלח לרו"ח ומה שהעובד ראה.';

-- ── תפעול (SPEC §2.1) ───────────────────────────────────────────────────────

-- SPEC §4.4 — מנוע כללים לומד.
create table rules (
  id              uuid primary key default gen_random_uuid(),
  pattern         text not null,
  is_regex        boolean not null default false,
  account_id      uuid references accounts(id),
  set_category_id uuid references categories(id),
  set_division    tx_division,
  set_nature      tx_nature,
  set_tx_class    tx_class,
  set_invoice_status invoice_status,
  set_deductible  boolean,
  priority        int not null default 100,
  -- כמה פעמים הכלל התאים — מזין את יעד ה-90% אוטומציה.
  hit_count       int not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references users(id),
  deleted_at      timestamptz
);

create index rules_priority_idx on rules (priority, id) where active and deleted_at is null;

create table tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  assignee_id    uuid references users(id),
  due_date       date,
  priority       text not null default 'normal'
                   check (priority in ('low', 'normal', 'high', 'urgent')),
  status         text not null default 'open'
                   check (status in ('open', 'in_progress', 'done', 'cancelled')),
  parent_task_id uuid references tasks(id),
  deal_id        uuid references deals(id),
  tx_id          uuid references transactions(id),
  period_id      uuid references periods(id),
  -- SPEC §2.1 — "כל פער שהמערכת מוצאת יוצר משימה אוטומטית".
  auto_generated boolean not null default false,
  auto_key       text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references users(id),
  deleted_at     timestamptz
);

-- משימה אוטומטית נוצרת פעם אחת בלבד לאותו פער.
create unique index tasks_auto_key_unique on tasks (auto_key)
  where auto_key is not null and deleted_at is null;

create index tasks_open_idx on tasks (assignee_id, due_date)
  where status in ('open', 'in_progress') and deleted_at is null;

-- SPEC §2.1, §5 מסך 16 — "לשאול את ניסים/אביב", השותף עונה מהנייד.
create table questions (
  id           uuid primary key default gen_random_uuid(),
  tx_id        uuid references transactions(id),
  deal_id      uuid references deals(id),
  asked_of     uuid references users(id),
  question     text not null,
  answer       text,
  answered_at  timestamptz,
  answered_by  uuid references users(id),
  status       text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

create table links (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  url          text not null,
  category     text not null,
  icon         text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

-- SPEC §4.1, §4.2, §11.9 — ייבוא idempotent: כל קובץ נרשם פעם אחת.
create table import_batches (
  id             uuid primary key default gen_random_uuid(),
  source         tx_source not null,
  file_name      text not null,
  file_hash      text not null,
  rows_total     int not null default 0,
  rows_created   int not null default 0,
  rows_skipped   int not null default 0,
  rows_flagged   int not null default 0,
  status         text not null default 'pending'
                   check (status in ('pending', 'review', 'applied', 'cancelled')),
  imported_by    uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references users(id),
  deleted_at     timestamptz
);

create unique index import_batches_hash_unique on import_batches (source, file_hash)
  where deleted_at is null;

comment on index import_batches_hash_unique is
  'SPEC §11.9 — "ריצה חוזרת על אותו קובץ = 0 שורות חדשות."';

select install_standard_triggers('lead_sources');
select install_standard_triggers('leads');
select install_standard_triggers('lead_costs');
select install_standard_triggers('deal_submissions');
select install_standard_triggers('employees');
select install_standard_triggers('employment_terms');
select install_standard_triggers('payroll_months');
select install_standard_triggers('rules');
select install_standard_triggers('tasks');
select install_standard_triggers('questions');
select install_standard_triggers('links');
select install_standard_triggers('import_batches');

-- ─── db/schema/006_addendum.sql ────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 006 — ADDENDUM: אינטגרציות, צ'קליסט ביצוע, התראות, אוטומציות
-- ADDENDUM ב.1, ב.3, ב.5, ב.9, ב.10, ב.11, חלק ג
-- ════════════════════════════════════════════════════════════════════════════

-- ── ADDENDUM ב.9 — השלמות ל-suppliers ──────────────────────────────────────

alter table suppliers
  add column emails text[] not null default '{}',
  add column default_division tx_division,
  add column default_tx_class tx_class,
  -- ביטוח לאומי, בנקים = לא מצפים לחשבונית. מונע "חשבונית חסרה" מזויפת.
  add column invoice_expected boolean not null default true,
  -- תבנית חילוץ נלמדת מהמסמך הראשון שאושר ידנית (ב.3).
  add column extraction_template jsonb;

comment on column suppliers.extraction_template is
  'ADDENDUM ב.3 — תבנית לספק חוזר. LLM משמש רק למסמך לא מוכר, וגם אז כהצעה.';

-- ── ADDENDUM ב.1 — חיבורי Google ───────────────────────────────────────────

create table integrations (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null check (provider in ('google', 'green_api', 'greeninvoice', 'wise')),
  account_label    text not null,
  scopes           text[] not null default '{}',
  -- ADDENDUM הנחיה 15: "refresh token ב-Vault. אסור לשמור סיסמאות."
  -- כאן נשמר רק *המזהה* של הסוד ב-Vault, לא הסוד עצמו.
  vault_secret_id  text,
  status           text not null default 'connected'
                     check (status in ('connected', 'expired', 'revoked', 'error')),
  last_ok_at       timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references users(id),
  deleted_at       timestamptz,
  unique (provider, account_label)
);

comment on table integrations is
  'ADDENDUM ב.1 — OAuth של המשתמש, scopes מינימליים. אין כאן סודות, רק מצב.';

-- ── ADDENDUM ב.3 — קליטת מסמכים ממייל ומדרייב ──────────────────────────────

create table inbox_candidates (
  id                uuid primary key default gen_random_uuid(),
  source            text not null check (source in ('gmail', 'drive', 'manual_upload')),
  -- מזהה ההודעה/הקובץ במקור — מונע עיבוד כפול.
  source_ref        text not null,
  received_at       timestamptz not null,
  sender            text,
  subject           text,
  file_name         text,
  file_url          text,
  -- מה חולץ מהמסמך. ADDENDUM הנחיה 17: הצעה בלבד עד אישור אנושי.
  extracted         jsonb,
  extraction_method text check (extraction_method in ('template', 'llm', 'manual')),
  -- לעולם לא true בלי אישור אנושי (הנחיה 17).
  verified          boolean not null default false,
  verified_by       uuid references users(id),
  verified_at       timestamptz,
  invoice_id        uuid references invoices(id),
  status            text not null default 'pending'
                      check (status in ('pending', 'matched', 'ignored', 'failed')),
  failure_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references users(id),
  deleted_at        timestamptz,
  unique (source, source_ref)
);

comment on constraint inbox_candidates_source_source_ref_key on inbox_candidates is
  'ADDENDUM הנחיה 19 + SPEC §11.9 — סריקה חוזרת של אותה תיבה לא מייצרת כפילות.';

-- אכיפה ברמת ה-DB של הנחיה 17: אין verified בלי מי ומתי.
alter table inbox_candidates add constraint verified_needs_human
  check (verified = false or (verified_by is not null and verified_at is not null));

-- ── ADDENDUM ב.5 — צ'קליסט ביצוע וגביה ─────────────────────────────────────

create table checklist_templates (
  id           uuid primary key default gen_random_uuid(),
  product      text not null,
  label        text not null,
  sort_order   int not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz,
  unique (product, sort_order)
);

create table deal_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references deals(id),
  sort_order      int not null,
  label           text not null,
  status          text not null default 'pending'
                    check (status in ('done', 'pending', 'blocked', 'n/a')),
  blocked_reason  text,
  status_since    date,
  marked_by       uuid references users(id),
  document_id     uuid references invoices(id),
  -- ADDENDUM ב.5 — שינוי שלב ב-WISE מסמן פריטים אוטומטית.
  auto_source     text check (auto_source in ('wise', 'invoice', 'transaction')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references users(id),
  deleted_at      timestamptz,
  unique (deal_id, sort_order),
  constraint blocked_needs_reason
    check (status <> 'blocked' or blocked_reason is not null)
);

create index deal_checklist_open_idx on deal_checklist_items (deal_id, sort_order)
  where status <> 'done' and deleted_at is null;

-- ── ADDENDUM ב.11 — התראות ─────────────────────────────────────────────────

create table alerts (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,
  -- ADDENDUM הנחיה 18 — "מניעת כפילויות היא חובה, לא שיפור."
  rule_key       text not null,
  severity       text not null check (severity in ('critical', 'high', 'info')),
  channels       text[] not null default '{}',
  title          text not null,
  detail         text,
  amount         numeric(14,2),
  ref_ids        text[],
  snoozed_until  date,
  resolved_at    timestamptz,
  resolved_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references users(id),
  deleted_at     timestamptz
);

-- התראה פעילה אחת לכל בעיה. אחרי סגירה אפשר שתיווצר שוב.
create unique index alerts_rule_key_active
  on alerts (rule_key) where resolved_at is null and deleted_at is null;

create index alerts_active_idx on alerts (severity, created_at desc)
  where resolved_at is null and deleted_at is null;

-- ── ADDENDUM הנחיה 16 — שכבת outbox אחת לכל יציאה החוצה ────────────────────

create table outbox (
  id             uuid primary key default gen_random_uuid(),
  channel        text not null check (channel in ('email', 'whatsapp', 'calendar', 'drive', 'sheets', 'gmail_forward')),
  -- לאן. מייל / טלפון / מזהה יומן.
  target         text not null,
  subject        text,
  body           text,
  payload        jsonb,
  -- מונע שליחה כפולה של אותו דבר.
  dedup_key      text,
  status         text not null default 'pending'
                   check (status in ('pending', 'sent', 'failed', 'cancelled')),
  attempts       int not null default 0,
  max_attempts   int not null default 5,
  next_attempt_at timestamptz not null default now(),
  sent_at        timestamptz,
  last_error     text,
  alert_id       uuid references alerts(id),
  task_id        uuid references tasks(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references users(id),
  deleted_at     timestamptz
);

create unique index outbox_dedup on outbox (dedup_key)
  where dedup_key is not null and deleted_at is null;

create index outbox_pending_idx on outbox (next_attempt_at)
  where status = 'pending' and deleted_at is null;

comment on table outbox is
  'ADDENDUM הנחיה 16 — "אין קריאות ישירות מהקוד העסקי." כל מייל, וואטסאפ
   ואירוע יומן עובר דרך כאן, עם retry ולוג.';

-- ── ADDENDUM ב.9 + חלק ג — דוחות וג׳ובים ───────────────────────────────────

create table report_runs (
  id           uuid primary key default gen_random_uuid(),
  report_type  text not null,
  period       text,
  file_url     text,
  file_format  text check (file_format in ('pdf', 'xlsx', 'csv', 'sheets')),
  recipients   text[] not null default '{}',
  sent_at      timestamptz,
  outbox_id    uuid references outbox(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

comment on table report_runs is
  'ADDENDUM ב.9 — מאפשר "שלח שוב" ו"מה נשלח לרו"ח בחודש X".';

create table scheduled_jobs_log (
  id           bigserial primary key,
  job_name     text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running'
                 check (status in ('running', 'succeeded', 'failed', 'skipped')),
  rows_touched int,
  error        text,
  detail       jsonb
);

create index scheduled_jobs_log_idx on scheduled_jobs_log (job_name, started_at desc);

comment on table scheduled_jobs_log is
  'ADDENDUM חלק ג — כל ריצה נרשמת. מסך "בריאות המערכת" מציג 7 ימים אחרונים.';

-- ── ADDENDUM ב.7 — צ'קליסט סגירת חודש לרו"ח ────────────────────────────────

create table month_close_checklist (
  id           uuid primary key default gen_random_uuid(),
  period       char(7) not null check (period ~ '^\d{4}-\d{2}$'),
  item_key     text not null,
  label        text not null,
  -- כל ✓ אוטומטי מהנתונים (ב.7), ולכן אין כאן "מי סימן".
  is_done      boolean not null default false,
  checked_at   timestamptz,
  detail       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz,
  unique (period, item_key)
);

-- ── ADDENDUM ב.10 — השלמות למשימות ─────────────────────────────────────────

alter table tasks
  add column description text,
  add column tags text[] not null default '{}',
  add column employee_id uuid references employees(id),
  add column supplier_id uuid references suppliers(id),
  add column recurrence_rule text,
  add column waiting_on uuid references users(id);

-- `auto_key` הקיים הוא ה-rule_key של ADDENDUM הנחיה 18.
comment on column tasks.auto_key is
  'ADDENDUM הנחיה 18 — rule_key: אותה בעיה לא יוצרת שתי משימות.
   ADDENDUM ב.10 — המשימה נסגרת לבד כשהתנאי מפסיק להתקיים.';

-- ── ADDENDUM ב.9 — תקציבים (מוזכר ב-ב.11 "חריגת תקציב") ────────────────────

create table budgets (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references categories(id),
  division     tx_division not null,
  period       char(7) not null check (period ~ '^\d{4}-\d{2}$'),
  amount_net   numeric(14,2) not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz,
  unique (category_id, division, period)
);

-- ── ADDENDUM §3.7.3 — תצלומי תחזית למדידת דיוק ─────────────────────────────

create table forecast_snapshots (
  id                     uuid primary key default gen_random_uuid(),
  target_month           char(7) not null check (target_month ~ '^\d{4}-\d{2}$'),
  forecasted_at          date not null,
  horizon_days           int not null check (horizon_days in (30, 60, 90)),
  division               text not null check (division in ('realestate', 'finance', 'unified')),
  scenario               text not null check (scenario in ('pessimistic', 'base', 'optimistic')),
  predicted_collections  numeric(14,2) not null,
  predicted_profit       numeric(14,2) not null,
  -- ההנחות שעמדו מאחורי החיזוי — כדי שאפשר יהיה להסביר טעות בדיעבד.
  assumptions            jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references users(id),
  deleted_at             timestamptz,
  unique (target_month, horizon_days, division, scenario)
);

comment on table forecast_snapshots is
  'SPEC §3.7.3 — "כל חודש שנסגר, המערכת שומרת מה חזתה 30/60/90 יום קודם
   מול מה קרה. מוצג כאחוז — כדי שתדע כמה לסמוך."';

select install_standard_triggers('integrations');
select install_standard_triggers('inbox_candidates');
select install_standard_triggers('checklist_templates');
select install_standard_triggers('deal_checklist_items');
select install_standard_triggers('alerts');
select install_standard_triggers('outbox');
select install_standard_triggers('report_runs');
select install_standard_triggers('month_close_checklist');
select install_standard_triggers('budgets');
select install_standard_triggers('forecast_snapshots');

-- ─── db/schema/007_jsonb_shape.sql ─────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 007 — עמודות jsonb חייבות להחזיק אובייקט, לא מחרוזת JSON.
--
-- הבאג שזה תופס: `${JSON.stringify(obj)}::jsonb` מפרמטר נשמר כ-JSON *string*
-- ("{\"finance\":0.8}"), ואז `value -> 'finance'` מחזיר NULL בשקט — מפתח חלוקה
-- משותף היה נופל לברירת המחדל בלי שאף אחד ישים לב. עכשיו ה-INSERT נדחה.
-- ════════════════════════════════════════════════════════════════════════════

alter table transactions   add constraint tx_split_is_object
  check (division_split is null or jsonb_typeof(division_split) = 'object');
alter table fixed_expenses add constraint fixed_split_is_object
  check (division_split is null or jsonb_typeof(division_split) = 'object');
alter table employees      add constraint employee_split_is_object
  check (jsonb_typeof(division_split) = 'object');
alter table periods        add constraint period_snapshot_is_object
  check (snapshot_json is null or jsonb_typeof(snapshot_json) = 'object');
alter table employment_terms add constraint terms_components_is_array
  check (jsonb_typeof(components) = 'array');
alter table payroll_months add constraint payroll_adjustments_is_array
  check (jsonb_typeof(manual_adjustments) = 'array');
-- settings מחזיקה גם סקלרים (0.18, 500000) — רק לא מחרוזת שנראית כמו JSON
alter table settings add constraint settings_not_double_encoded
  check (jsonb_typeof(value) <> 'string' or (value #>> '{}') !~ '^\s*[\[{]');

-- ─── db/schema/008_import_rows.sql ─────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 008 — ייבוא כרטיס אשראי: שורות לבדיקה בין ההעלאה לאישור (SPEC §4.1, §4.4)
--
-- ההעלאה מפרקת את הקובץ לשורות, מריצה את `rules` ושומרת *הצעה* לכל שורה.
-- שום דבר לא נכנס ל-transactions עד ש"החל ייבוא" — ואז האב + הבנות נכתבים
-- בטרנזקציה אחת. השורות נשארות כתיעוד: מה הוצע, מה שונה ידנית, מה דולג.
-- ════════════════════════════════════════════════════════════════════════════

alter table import_batches
  add column account_id  uuid references accounts(id),
  add column meta        jsonb,
  add column applied_at  timestamptz;

alter table import_batches add constraint import_meta_is_object
  check (meta is null or jsonb_typeof(meta) = 'object');

comment on column import_batches.meta is
  'תוצאת הפענוח: פורמט, יום חיוב, סכום האב, אזהרות. אובייקט jsonb (008).';

create table import_rows (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references import_batches(id),
  row_index        int not null,
  -- SPEC §4.1 — dedup: מס' עסקה + תאריך + סכום.
  source_ref       text not null,
  date             date not null,
  merchant         text not null,
  amount           numeric(14,2) not null,
  amount_original  numeric(14,2),
  reference        text,
  category_hint    text,
  notes            text,
  card_last4       text,

  -- ההצעה (מ-rules) והבחירה הסופית — אותם שדות; המסך עורך את הבחירה.
  rule_id          uuid references rules(id),
  matched_pattern  text,
  nature           tx_nature not null default 'expense',
  division         tx_division not null default 'finance',
  category_id      uuid references categories(id),
  tx_class         tx_class not null default 'business',
  invoice_status   invoice_status not null default 'unknown',
  deductible       boolean,
  review_status    review_status not null default 'ok',

  -- pending → approved / skipped. duplicate = כבר קיים ב-transactions (לא ייכתב).
  decision         text not null default 'pending'
                     check (decision in ('pending', 'approved', 'skipped', 'duplicate')),
  -- true = הסיווג נבחר ע"י המשתמש ולא ע"י כלל → מועמד ל"להפוך לכלל?" (§4.4).
  edited           boolean not null default false,
  applied_tx_id    uuid references transactions(id),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references users(id),
  deleted_at       timestamptz,

  -- §2.1 — nature=advance חייב finance; הוצאה חייבת קטגוריה כשמאשרים.
  constraint import_row_advance_is_finance check (nature <> 'advance' or division = 'finance'),
  constraint import_row_approved_expense_has_category
    check (decision <> 'approved' or nature <> 'expense' or category_id is not null)
);

-- אותה שורה לא נכנסת פעמיים לאותו קובץ.
create unique index import_rows_ref_unique on import_rows (batch_id, source_ref) where deleted_at is null;
create index import_rows_batch_idx on import_rows (batch_id, row_index) where deleted_at is null;

select install_standard_triggers('import_rows');

comment on table import_rows is
  'SPEC §4.1 — מסך האישור של ייבוא אשראי. שורה = הצעת סיווג; transactions נכתבת רק ב-apply.';

-- ─── db/schema/009_daily_close.sql ─────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 009 — סגירת יום (SPEC §3.6) ואירועי ג'ובים
--
-- "סגירת יום: צפי אתמול − עוגן היום = סטייה → תור 'מה קרה?'"
-- כל עוגן חדש (balances) מייצר שורה כאן: מה התזרים חזה, מה נכנס בפועל, מה
-- מוסבר ע"י תנועות שנרשמו, ומה נשאר לא מוסבר. התור במסך 3 ("סטיות") עובד
-- על השורות הפתוחות עם 3 כפתורים: סווג / הוצאה קבועה חדשה / התעלם.
-- ════════════════════════════════════════════════════════════════════════════

create table daily_closes (
  id                   uuid primary key default gen_random_uuid(),
  date                 date not null,
  account_id           uuid not null references accounts(id),
  previous_anchor_date date,
  previous_anchor      numeric(14,2),
  -- previous_anchor + Σ פריטים ודאיים בין העוגנים (מה שהתזרים חזה).
  predicted            numeric(14,2) not null,
  actual               numeric(14,2) not null,
  -- Σ תנועות בפועל שנרשמו בין העוגנים.
  recorded             numeric(14,2) not null default 0,
  -- actual − predicted: ההתראה של §3.6.
  variance             numeric(14,2) not null,
  -- actual − (previous_anchor + recorded): כסף שזז ואף אחד לא רשם.
  unexplained          numeric(14,2) not null,
  exceeds_threshold    boolean not null default false,
  status               text not null default 'open'
                         check (status in ('ok', 'open', 'classified', 'fixed_expense', 'ignored')),
  resolution_tx_id     uuid references transactions(id),
  resolution_fixed_id  uuid references fixed_expenses(id),
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references users(id),
  deleted_at           timestamptz,
  -- סגירה אחת ליום לכל חשבון; עוגן שהוזן שוב באותו יום מעדכן אותה.
  unique (account_id, date)
);

create index daily_closes_open_idx on daily_closes (date desc) where status = 'open' and deleted_at is null;

select install_standard_triggers('daily_closes');

comment on table daily_closes is
  'SPEC §3.6 סגירת יום. variance = ההתראה; unexplained = תור "מה קרה?".';

-- הגדרות מסירה (ADDENDUM ב.11 ערוצים). אין ערכי ברירת מחדל — דן מגדיר:
--   node scripts/set-setting.mjs notify_whatsapp_dan '"9725xxxxxxx"'
--   node scripts/set-setting.mjs notify_email_dan '"dan@..."'
comment on table settings is
  'מפתחות מסירה: notify_whatsapp_dan, notify_email_dan. ספי התראות: alert_thresholds (אובייקט לפי lib/rules/alerts.ts).';

-- ─── db/schema/010_integration_secrets.sql ─────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 010 — סודות אינטגרציה (ADDENDUM ב.1 / הנחיה 15)
--
-- integrations לא מחזיקה סוד (הבטחה מבנית "אין עמודת סוד ב-integrations").
-- הסוד (refresh token) יושב כאן *מוצפן* — AES-256-GCM עם SECRETS_KEY שנמצא רק
-- בסביבת השרת (lib/secrets.ts). ב-Supabase הטבלה הזו מוחלפת ב-Vault; המפתח
-- vault_secret_id ב-integrations נשאר אותו דבר.
-- ════════════════════════════════════════════════════════════════════════════

create table integration_secrets (
  id           uuid primary key default gen_random_uuid(),
  -- {iv, tag, ciphertext, alg} — אף שדה כאן אינו קריא בלי המפתח.
  sealed       jsonb not null check (jsonb_typeof(sealed) = 'object' and sealed ? 'ciphertext' and sealed ? 'iv' and sealed ? 'tag'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

select install_standard_triggers('integration_secrets');

-- audit_log (§11.4) מקליט את השורה — כלומר ciphertext בלבד; בלי SECRETS_KEY אין בו כלום.

comment on table integration_secrets is
  'הנחיה 15 — refresh tokens מוצפנים; המפתח מחוץ ל-DB. ב-Supabase: Vault.';

-- לאיזה שירותים חוברנו בפועל (Google עשוי לאשר פחות ממה שביקשנו).
alter table integrations add column if not exists connected_email text;

-- ─── db/schema/011_intake.sql ──────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 011 — קליטת מסמכים (ADDENDUM ב.3): טקסט המסמך, סוג, קישור לתנועה/אצווה
-- ════════════════════════════════════════════════════════════════════════════

alter table inbox_candidates
  -- הטקסט שחולץ מה-PDF — לתבנית הספק הנלמדת (ב.3 שלב 3) ולהצגה.
  add column doc_text        text,
  -- ב.3 שלב 2/4: חשבונית → invoices; דף פירוט/בנק → תור הייבוא (4.1/4.2).
  add column kind            text not null default 'unknown' check (kind in ('invoice', 'statement', 'unknown')),
  add column local_path      text,
  add column matched_tx_id   uuid references transactions(id),
  add column import_batch_id uuid references import_batches(id),
  -- ב.3 שלב 6: הועבר לחשבונית ירוקה (דרך outbox).
  add column forwarded_outbox_id uuid references outbox(id);

alter table inbox_candidates add constraint inbox_extracted_is_object
  check (extracted is null or jsonb_typeof(extracted) = 'object');

-- ב.3 שלב 5: חשבונית שלא שודכה = "חשבונית ללא תנועה" → תזרים (committed) עם תאריך יעד.
alter table invoices add column if not exists due_date date;
alter table invoices add column if not exists inbox_candidate_id uuid references inbox_candidates(id);

comment on column invoices.due_date is
  'ADDENDUM ב.3 שלב 5 — חשבונית שהתקבלה ולא שולמה נכנסת לתזרים כ-committed בתאריך היעד.';

-- ─── db/schema/012_collections.sql ─────────────────────────────────────
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

-- ─── db/schema/013_bank_and_gi.sql ─────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 013 — שלב 6: ייבוא דפי בנק (§4.2) וחשבונית ירוקה (§4.3)
--
-- דף בנק עובר את אותו מסך אישור של האשראי (import_rows), אבל עם שידוך:
-- לכל שורת בנק מחפשים תנועה קיימת (±1 ₪, ±3 ימים, אותו חשבון). לכן שתי עמודות
-- חדשות: למה שודך, ובאיזו ודאות.
-- ════════════════════════════════════════════════════════════════════════════

alter table import_rows
  add column matched_tx_id uuid references transactions(id),
  add column match_status  text not null default 'none'
    check (match_status in ('matched', 'candidates', 'none')),
  -- היתרה בדף אחרי השורה — לאימות היתרה המתגלגלת (§4.2).
  add column balance       numeric(14,2),
  -- מועמדי שידוך שנשקלו, לתצוגה במסך האישור.
  add column match_candidates jsonb;

alter table import_rows add constraint import_row_candidates_is_array
  check (match_candidates is null or jsonb_typeof(match_candidates) = 'array');

-- שורת בנק ששודכה לתנועה קיימת לא יוצרת תנועה חדשה, ולכן אין לה קטגוריה לבחור.
-- האילוץ המקורי (008) נשמר לכל השאר: הוצאה שמאושרת ליצירה חייבת קטגוריה.
alter table import_rows drop constraint import_row_approved_expense_has_category;
alter table import_rows add constraint import_row_approved_expense_has_category
  check (decision <> 'approved' or nature <> 'expense' or category_id is not null or matched_tx_id is not null);

comment on column import_rows.match_status is
  'SPEC §4.2 — התאמה מלאה / מועמדים / ללא התאמה. ללא התאמה → תנועה חדשה עם unknown_expense.';

-- §4.3 — מפתח חשבון של חשבונית ירוקה לכל קטגוריה (3011 שכר, 3570 שכירות…).
-- העמודה קיימת מ-002; כאן רק מוודאים שהיא מתועדת כמקור לפלט לרו"ח.
comment on column categories.gi_account_key is
  'SPEC §4.3, §7 — מפתח החשבון בפלט לרו"ח. הסיווג בחשבונית ירוקה לא קיים; אנחנו המסווגים.';

-- §4.3 — מסמך שהוא של ישות שותף אינו הוצאה (משיכה/התחשבנות) ודורש אישור.
alter table invoices
  add column needs_partner_review boolean not null default false,
  add column partner_id uuid references partners(id);

create index invoices_partner_review_idx on invoices (needs_partner_review)
  where needs_partner_review and deleted_at is null;

comment on column invoices.needs_partner_review is
  'SPEC §4.3 — ספק ∈ {די.אנד.די, אביב, ניסים} → nature=draw, דורש אישור (שאלה #15).';

-- ─── db/schema/014_partners.sql ────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- 014 — שלב 7: נדל"ן. משיכות שותפים (§3.5), חו"ז בעלים, חוב המשקיע.
--
-- הטבלאות עצמן (partners, partner_draws, private_income) קיימות מ-004.
-- כאן נוסף מה שחסר כדי שמסך 8 יעבוד: יתרת פתיחה של הלוואת משקיע, ותיעוד
-- מפורש של מה נספר כמשיכה מול היעד.
-- ════════════════════════════════════════════════════════════════════════════

/*
 * SPEC §3.5 — "חוב_ליוני = 200,000 (פתיחה) − Σ repayments → מוצג עם קצב ירידה".
 * היתרה יושבת על השותף ולא בהגדרות, כי היא נתון של אדם ולא של המערכת, והיא
 * חייבת להיכנס ליומן השינויים כמו כל נתון כספי אחר.
 *
 * ברירת המחדל 0 ולא 200,000 בכוונה: את הסכום מזין דן במסך (שאלה פתוחה #8 —
 * מקור החוב וקצב ההחזר). המערכת לא כותבת לעצמה מספר שלא אושר.
 */
alter table partners
  add column if not exists investor_loan_opening numeric(14,2) not null default 0,
  add column if not exists investor_loan_note    text;

do $$
begin
  alter table partners add constraint partners_investor_loan_nonneg
    check (investor_loan_opening >= 0);
exception when duplicate_object then null; end;
$$;

comment on column partners.investor_loan_opening is
  'SPEC §3.5 — יתרת פתיחה של הלוואת משקיע (יוני: 200,000 לפי האפיון). 0 = טרם הוזנה.';

-- ההחזרים והלוואות הבעלים נשלפים לפי שותף ותאריך בכל טעינה של מסך 8.
create index if not exists partner_draws_type_idx on partner_draws (type, date)
  where deleted_at is null;

comment on column partner_draws.type is
  'SPEC §3.5 — salary / management_fee / dividend נספרים כמשיכה מול היעד. '
  'owner_loan ו-loan_repayment הם חו"ז ולא משיכה.';

comment on column private_income.split_dan is
  'SPEC §2.1 — הכנסות פרייבט נפרדות לחלוטין מהחברה. הטבלה הזו לא מצטרפת '
  'לשום שאילתה של transactions, וגם לא ל-v_tx_allocated.';

-- ─── db/views/001_base.sql ─────────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- Views — שכבת בסיס
-- SPEC §1.1 "כל השאר נגזר" · נספח ב ליקוי #1 "אין נוסחאות בתאים, רק views"
-- ════════════════════════════════════════════════════════════════════════════

-- ── מפתחות חלוקה (SPEC §1.2) ───────────────────────────────────────────────

-- ברירת המחדל מההגדרות, כשורה אחת שאפשר ל-JOIN אליה.
create or replace view v_default_split as
select
  coalesce((value -> 'finance')::numeric,    0.8) as finance_pct,
  coalesce((value -> 'realestate')::numeric, 0.2) as realestate_pct
from settings
where key = 'default_division_split'
union all
select 0.8, 0.2
where not exists (select 1 from settings where key = 'default_division_split')
limit 1;

/*
 * v_tx_allocated — כל תנועה, מפורקת לפעילות שאליה היא שייכת.
 *
 * זהו הבסיס שכל דוח פעילות נשען עליו, והמקום היחיד שבו `shared` מתפרק.
 * תנועה משותפת מופיעה כאן *פעמיים* — פעם למימון ופעם לנדל"ן — וסכום שתי
 * השורות שווה לסכום המקורי, כך שאין לא כפילות ולא איבוד.
 *
 * `private` אינה מופיעה כלל (SPEC §2.1).
 */
create or replace view v_tx_allocated as
with split as (select * from v_default_split)
select
  t.id                as tx_id,
  t.date_cash,
  t.date_doc,
  t.account_id,
  t.nature,
  t.category_id,
  t.deal_id,
  t.fixed_expense_id,
  t.partner_id,
  t.tx_class,
  t.deductible,
  t.invoice_status,
  t.review_status,
  t.certainty,
  t.parent_id,
  t.counterparty,
  t.description,
  t.cash_discount,
  to_char(t.date_cash, 'YYYY-MM') as month_cash,
  d.division,
  d.weight,
  round(t.amount_net   * d.weight, 2) as amount_net,
  round(t.vat_amount   * d.weight, 2) as vat_amount,
  round(t.amount_gross * d.weight, 2) as amount_gross
from transactions t
cross join split s
cross join lateral (
  select * from (values
    ('realestate'::concrete_division,
      case
        when t.division = 'realestate' then 1::numeric
        when t.division = 'shared' then
          coalesce((t.division_split -> 'realestate')::numeric, s.realestate_pct)
        else 0
      end),
    ('finance'::concrete_division,
      case
        when t.division = 'finance' then 1::numeric
        when t.division = 'shared' then
          coalesce((t.division_split -> 'finance')::numeric, s.finance_pct)
        else 0
      end)
  ) as v(division, weight)
) d
where t.deleted_at is null
  and t.division <> 'private'
  and d.weight > 0;

comment on view v_tx_allocated is
  'SPEC §1.2 — המקום היחיד בקוד שבו shared מתפרק. כל דוח פעילות עובר דרך כאן.';

/*
 * v_tx_classified — רמת הסיווג.
 *
 * SPEC §2.1: שורת-בת של חיוב אשראי לא נספרת בתזרים; לצורך סיווג וקטגוריות
 * ההפך נכון — הבנות נושאות את הקטגוריה והאב הוא רק סך החיוב בבנק.
 * הדוחות בוחרים: v_tx_classified לרווח והפסד ולמע"מ, v_tx_cash לתזרים.
 */
create or replace view v_tx_classified as
select a.*
from v_tx_allocated a
where a.parent_id is not null
   or not exists (
     select 1 from transactions c
     where c.parent_id = a.tx_id and c.deleted_at is null
   );

/* v_tx_cash — רק תנועות שמייצגות כסף שזז בחשבון. */
create or replace view v_tx_cash as
select * from v_tx_allocated where parent_id is null;

-- ── חודש שיוך עסקה (SPEC §3.4) ─────────────────────────────────────────────

/*
 * v_deal_month — חודש ההתחשבנות של כל תיק.
 *
 * "ברירת מחדל: החודש שבו נכנס התקבול הראשון. ניתן לדריסה ידנית."
 * NULL כאן = תיק בלי חודש; אם יש בו כסף, זה חריג שחוסם סגירה (§3.3).
 */
create or replace view v_deal_month as
select
  d.id as deal_id,
  d.division,
  d.status,
  d.fee_agreed_net,
  coalesce(
    d.month_attributed,
    to_char(
      (select min(t.date_cash)
       from transactions t
       where t.deal_id = d.id
         and t.nature = 'income'
         and t.certainty = 'actual'
         and t.deleted_at is null),
      'YYYY-MM')
  ) as month_attributed,
  d.month_attributed is not null as month_is_manual
from deals d
where d.deleted_at is null;

/*
 * v_deal_balance — נגזרות התיק (SPEC §2.1).
 * מתקן את ליקוי #1 ו-#3 בנספח ב: "נגבה" הוא סכום התנועות בפועל,
 * לא שדה שמישהו הקליד, ולא "כן/לא" שקובע כסף.
 */
create or replace view v_deal_balance as
select
  d.id as deal_id,
  d.client_name,
  d.division,
  d.status,
  d.collection_status,
  d.fee_agreed_net,
  dm.month_attributed,
  coalesce(inc.collected_net, 0)                          as collected_net,
  d.fee_agreed_net - coalesce(inc.collected_net, 0)       as open_balance_net,
  coalesce(exp.direct_costs_net, 0)                       as direct_costs_net,
  coalesce(inc.collected_net, 0) - coalesce(exp.direct_costs_net, 0) as net_contribution,
  coalesce(plan.committed_open, 0)                        as open_committed,
  coalesce(plan.expected_open, 0)                         as open_expected_weighted
from deals d
join v_deal_month dm on dm.deal_id = d.id
left join lateral (
  select sum(t.amount_net) as collected_net
  from transactions t
  where t.deal_id = d.id and t.nature = 'income'
    and t.certainty = 'actual' and t.deleted_at is null
) inc on true
left join lateral (
  select abs(sum(t.amount_net)) as direct_costs_net
  from transactions t
  where t.deal_id = d.id and t.nature = 'expense'
    and t.certainty = 'actual' and t.deleted_at is null
) exp on true
left join lateral (
  select
    sum(p.amount_net) filter (where p.certainty = 'committed') as committed_open,
    sum(p.amount_net * p.probability) filter (where p.certainty = 'expected') as expected_open
  from deal_payments_plan p
  where p.deal_id = d.id and p.matched_tx_id is null and p.deleted_at is null
) plan on true
where d.deleted_at is null;

comment on view v_deal_balance is
  'SPEC נספח א — "נגבה בפועל" ו"פתוח לגביה" הם נגזרות, לא עמודות שמוקלדות.';

-- ─── db/views/002_reports.sql ──────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- Views — דוחות: רווח והפסד, כרטיס ניסים, מע"מ, תזרים, המרה
-- SPEC §3.1–§3.8 · §8 ("views: v_pnl, v_nissim_card, v_cashflow_13w, v_vat, v_conversion")
-- ════════════════════════════════════════════════════════════════════════════

-- ── v_pnl — רווח והפסד, שתי הגדרות (SPEC §3.2) ─────────────────────────────

/*
 * רווח *תפעולי*: כל ההכנסות וההוצאות בפועל, לפי חודש התנועה.
 * כולל הוצאות לא מוכרות ולא מאושרות — זה מה שבאמת יצא מהקופה.
 */
create or replace view v_pnl_operational as
select
  c.division,
  c.month_cash                                            as month,
  sum(c.amount_net) filter (where c.nature = 'income')    as income,
  abs(sum(c.amount_net) filter (where c.nature = 'expense')) as expenses,
  abs(sum(c.amount_net) filter (
    where c.nature = 'expense' and c.fixed_expense_id is not null
  ))                                                      as fixed_expenses,
  abs(sum(c.amount_net) filter (
    where c.nature = 'expense' and c.deal_id is not null
  ))                                                      as direct_expenses,
  sum(c.amount_net) filter (where c.nature in ('income', 'expense')) as profit
from v_tx_classified c
where c.certainty = 'actual'
  and c.nature in ('income', 'expense')   -- SPEC §1.3
group by c.division, c.month_cash;

/*
 * רווח *לחלוקה*: הסכם השותפות.
 *   • הכנסות — רק עם deal_id, בחודש שבו התקבול נכנס (§3.4).
 *   • הוצאות קבועות — רק deductible, ובמימון גם approved_by_nissim (§3.2).
 *   • הוצאות ישירות — לפי חודש *התיק*, לא חודש התנועה.
 */
create or replace view v_pnl_distributable as
with income as (
  select c.division, c.month_cash as month, sum(c.amount_net) as income
  from v_tx_classified c
  where c.certainty = 'actual' and c.nature = 'income' and c.deal_id is not null
  group by c.division, c.month_cash
),
fixed_and_variable as (
  select
    c.division,
    c.month_cash as month,
    abs(sum(c.amount_net)) as amount,
    abs(sum(c.amount_net) filter (where c.fixed_expense_id is not null)) as fixed_only
  from v_tx_classified c
  left join fixed_expenses f on f.id = c.fixed_expense_id
  where c.certainty = 'actual'
    and c.nature = 'expense'
    and c.deal_id is null
    and c.deductible is true
    and (
      c.fixed_expense_id is null                        -- משתנה מוכרת
      or c.division = 'realestate'                      -- §3.5: אין דרישת אישור
      or f.approved_by_nissim is true                   -- §3.2: מימון דורש אישור
    )
  group by c.division, c.month_cash
),
direct as (
  select
    c.division,
    dm.month_attributed as month,
    abs(sum(c.amount_net)) as amount
  from v_tx_classified c
  join v_deal_month dm on dm.deal_id = c.deal_id
  where c.certainty = 'actual'
    and c.nature = 'expense'
    and c.deal_id is not null
    and c.deductible is true
    and dm.month_attributed is not null
  group by c.division, dm.month_attributed
)
select
  coalesce(i.division, fv.division, dr.division) as division,
  coalesce(i.month, fv.month, dr.month)          as month,
  coalesce(i.income, 0)                          as income,
  coalesce(fv.amount, 0)                         as fixed_expenses,
  coalesce(dr.amount, 0)                         as direct_expenses,
  coalesce(i.income, 0) - coalesce(fv.amount, 0) - coalesce(dr.amount, 0) as profit
from income i
full outer join fixed_and_variable fv on fv.division = i.division and fv.month = i.month
full outer join direct dr
  on dr.division = coalesce(i.division, fv.division)
 and dr.month    = coalesce(i.month, fv.month);

create or replace view v_pnl as
select 'operational' as mode, division, month, income,
       fixed_expenses, direct_expenses, expenses as total_expenses, profit
from v_pnl_operational
union all
select 'distributable', division, month, income,
       fixed_expenses, direct_expenses, fixed_expenses + direct_expenses, profit
from v_pnl_distributable;

comment on view v_pnl is
  'SPEC §3.2 — שתי הגדרות רווח, בכוונה. המסך מחליף ביניהן במתג ומכריז איזו מוצגת.';

-- ── v_nissim_card — 8 שורות סגירת החודש (SPEC §3.3) ────────────────────────

/*
 * שורות 1–6. היתרה המתגלגלת (7–8) מחושבת ב-v_nissim_card, שכן היא
 * תלויה בחודש הקודם ודורשת חלון.
 */
create or replace view v_nissim_card_lines as
with months as (
  select distinct month from (
    select month from v_pnl_distributable where division = 'finance'
    union select period as month from advances where deleted_at is null
  ) m
),
profit as (
  select month, income, fixed_expenses, direct_expenses, profit
  from v_pnl_distributable
  where division = 'finance'
),
adv as (
  select period as month, sum(amount_gross) as advances
  from advances where deleted_at is null
  group by period
),
nissim_pct as (
  select coalesce((value #>> '{}')::numeric, 0.5) as pct
  from settings where key = 'nissim_share_pct'
  union all select 0.5
  where not exists (select 1 from settings where key = 'nissim_share_pct')
  limit 1
)
select
  m.month,
  coalesce(p.income, 0)                         as line1_collected_income,
  coalesce(p.fixed_expenses, 0)                 as line2_approved_fixed,
  coalesce(p.direct_expenses, 0)                as line3_direct,
  coalesce(p.profit, 0)                         as line4_distributable_profit,
  round(coalesce(p.profit, 0) * n.pct, 2)       as line5_nissim_share,
  coalesce(p.profit, 0) - round(coalesce(p.profit, 0) * n.pct, 2) as line5_harel_share,
  coalesce(a.advances, 0)                       as line6_advances
from months m
cross join nissim_pct n
left join profit p on p.month = m.month
left join adv    a on a.month = m.month;

/*
 * v_nissim_card — הכרטיס המלא, עם היתרה המתגלגלת.
 *
 * יתרת הפתיחה של החודש הראשון מגיעה מ-periods.opening_balance
 * ("מנקים שולחן", §3.3). משם הכל מחושב.
 *
 *   שורה 7: יתרה = פתיחה + מקדמות − חלק ניסים
 *   שורה 8: העברה = max(0, −יתרה)
 */
create or replace view v_nissim_card as
with opening as (
  select coalesce(
    (select p.opening_balance
     from periods p
     where p.division = 'finance' and p.opening_balance is not null and p.deleted_at is null
     order by p.year, p.month
     limit 1), 0) as amount,
  coalesce(
    (select to_char(make_date(p.year, p.month, 1), 'YYYY-MM')
     from periods p
     where p.division = 'finance' and p.opening_balance is not null and p.deleted_at is null
     order by p.year, p.month
     limit 1), '0000-00') as from_month
),
ordered as (
  select l.*, o.amount as opening_amount
  from v_nissim_card_lines l
  cross join opening o
  where l.month >= o.from_month
  order by l.month
)
select
  month,
  line1_collected_income,
  line2_approved_fixed,
  line3_direct,
  line4_distributable_profit,
  line5_nissim_share,
  line5_harel_share,
  line6_advances,
  opening_amount
    + sum(line6_advances - line5_nissim_share) over (order by month rows unbounded preceding)
    as line7_closing_balance,
  greatest(0, -(
    opening_amount
    + sum(line6_advances - line5_nissim_share) over (order by month rows unbounded preceding)
  )) as line8_transfer_due
from ordered;

comment on view v_nissim_card is
  'SPEC §3.3 — שורה 7 חיובית: ניסים חייב לחברה. שלילית: החברה חייבת לניסים,
   וההעברה מתבצעת עד ה-10.';

-- ── v_vat — חבות מע"מ (SPEC §3.1) ──────────────────────────────────────────

create or replace view v_vat as
select
  to_char(coalesce(c.date_doc, c.date_cash), 'YYYY-MM') as vat_month,
  c.division,
  -- coalesce ולא NULL: חודש בלי תשומות מוכרות הוא חבות מלאה, לא "אין נתון".
  -- בלי זה sum(...) filter (...) מחזיר NULL והחבות נעלמת (וזה בדיוק ההפך מ-lib/rules/vat.ts).
  coalesce(abs(sum(c.vat_amount) filter (where c.nature = 'income')), 0)
    as output_vat,
  coalesce(abs(sum(c.vat_amount) filter (
    where c.nature = 'expense' and c.invoice_status = 'has_invoice'
  )), 0) as input_vat_claimable,
  -- "כמה כסף אתה מפסיד אם לא תשיג אותן"
  coalesce(abs(sum(c.vat_amount) filter (
    where c.nature = 'expense' and c.invoice_status in ('missing', 'unknown')
  )), 0) as input_vat_missing_invoice,
  count(*) filter (
    where c.nature = 'expense' and c.invoice_status in ('missing', 'unknown')
  ) as missing_invoice_count,
  coalesce(abs(sum(c.vat_amount) filter (where c.nature = 'income')), 0)
    - coalesce(abs(sum(c.vat_amount) filter (
        where c.nature = 'expense' and c.invoice_status = 'has_invoice'
      )), 0) as liability
from v_tx_classified c
where c.certainty = 'actual' and c.nature in ('income', 'expense')
group by 1, 2;

-- ── v_cashflow_13w — תזרים (SPEC §3.6) ─────────────────────────────────────

/*
 * שורות הצפי קדימה: תקבולים מתיקים + הוצאות קבועות + מע"מ.
 * העוגן והצבירה השבועית מחושבים בשכבת ה-TS (lib/rules/cashflow.ts),
 * כי שם יושבת גם ההסתברות לפי שלב והרקב — ובדיקות היחידה מגנות עליהן.
 * ה-view מספק את החומר הגלם באותה צורה בדיוק.
 */
create or replace view v_cashflow_items as
-- תקבולים צפויים
select
  p.expected_date                         as date,
  d.client_name || ' — ' || p.label       as label,
  p.amount_net                            as amount,
  p.certainty::text                       as certainty,
  p.probability,
  'receipt'                               as kind,
  d.division::text                        as division,
  p.id                                    as ref_id
from deal_payments_plan p
join deals d on d.id = p.deal_id
where p.matched_tx_id is null and p.deleted_at is null and d.deleted_at is null

union all

-- הוצאות קבועות: שורה לכל חודש שבו הן מתממשות, 13 שבועות קדימה
select
  make_date(
    extract(year from gs)::int,
    extract(month from gs)::int,
    least(f.day_of_month, extract(day from (date_trunc('month', gs) + interval '1 month - 1 day'))::int)
  )                                       as date,
  f.name                                  as label,
  -abs(f.amount_net)                      as amount,
  'committed'                             as certainty,
  1::numeric                              as probability,
  'fixed_expense'                         as kind,
  f.division::text                        as division,
  f.id                                    as ref_id
from fixed_expenses f
cross join generate_series(
  date_trunc('month', current_date),
  date_trunc('month', current_date) + interval '3 months',
  interval '1 month'
) gs
where f.active
  and f.deleted_at is null
  and f.frequency = 'monthly'
  and gs >= date_trunc('month', f.start_date)
  and (f.end_date is null or gs <= f.end_date);

comment on view v_cashflow_items is
  'SPEC §3.6 — חומר הגלם לשני הקווים. הצבירה השבועית וההסתברות
   לפי שלב מחושבות ב-lib/rules/cashflow.ts, שם יש להן בדיקות יחידה.';

-- ── v_conversion — יחס המרה שבועי (SPEC §3.8) ──────────────────────────────

create or replace view v_conversion as
with weekly_leads as (
  select
    date_trunc('week', l.date + interval '1 day')::date - 1 as week,  -- שבוע שמתחיל בראשון
    l.source_id,
    l.product,
    count(*)                                               as leads,
    count(*) filter (where l.stage <> 'received')          as contacted,
    count(*) filter (where l.stage in ('meeting', 'proposal', 'signed', 'closed_won')) as meetings,
    count(*) filter (where l.stage in ('proposal', 'signed', 'closed_won')) as proposals,
    count(*) filter (where l.stage in ('signed', 'closed_won')) as signings,
    array_agg(l.deal_id) filter (where l.deal_id is not null) as deal_ids
  from leads l
  where l.deleted_at is null
  group by 1, 2, 3
),
weekly_costs as (
  select
    date_trunc('week', c.date + interval '1 day')::date - 1 as week,
    c.source_id,
    sum(abs(c.amount)) as cost
  from lead_costs c
  where c.deleted_at is null
  group by 1, 2
)
select
  wl.week,
  s.name                                        as source_name,
  wl.source_id,
  wl.product,
  wl.leads,
  wl.contacted,
  wl.meetings,
  wl.proposals,
  wl.signings,
  coalesce(rev.collected_deals, 0)              as collections,
  case when wl.leads > 0 then round(wl.signings::numeric / wl.leads, 4) end
    as conversion_to_signing,
  case when wl.leads > 0 then round(coalesce(rev.collected_deals, 0)::numeric / wl.leads, 4) end
    as conversion_to_collection,
  coalesce(wc.cost, 0)                          as lead_cost,
  case when wl.leads > 0 then round(coalesce(wc.cost, 0) / wl.leads, 2) end
    as cost_per_lead,
  case when wl.signings > 0 then round(coalesce(wc.cost, 0) / wl.signings, 2) end
    as cac,
  coalesce(rev.revenue, 0)                      as revenue,
  case when wl.leads > 0 then round(coalesce(rev.revenue, 0) / wl.leads, 2) end
    as revenue_per_lead,
  case when coalesce(wc.cost, 0) > 0 then round(coalesce(rev.revenue, 0) / wc.cost, 2) end
    as roi
from weekly_leads wl
join lead_sources s on s.id = wl.source_id
left join weekly_costs wc on wc.week = wl.week and wc.source_id = wl.source_id
left join lateral (
  select
    sum(b.collected_net)                                as revenue,
    count(*) filter (where b.collected_net > 0)         as collected_deals
  from v_deal_balance b
  where b.deal_id = any(wl.deal_ids)
) rev on true;

comment on view v_conversion is
  'SPEC §3.8 — המשפך ב-₪, לא בכמויות. הכמות היא רק המכנה.';

-- ── תור הפערים (SPEC §4.3, §5 מסך 12) ──────────────────────────────────────

create or replace view v_invoice_gaps as
-- בדיקה 1א: הכנסה בבנק בלי חשבונית
select
  'income_without_invoice'  as gap_kind,
  t.id                      as ref_id,
  t.date_cash               as date,
  t.amount_gross            as amount,
  0::numeric                as vat_at_risk,
  t.counterparty,
  t.description
from transactions t
where t.nature = 'income' and t.certainty = 'actual'
  and t.invoice_id is null and t.invoice_status in ('missing', 'unknown')
  and t.deleted_at is null

union all

-- בדיקה 1ב: חשבונית שהוצאה ואין לה תקבול = חייבים לנו
select
  'invoice_without_receipt',
  i.id, i.date, i.amount_gross, 0, i.counterparty, i.doc_number
from invoices i
where i.direction = 'issued' and i.matched_tx_id is null and i.deleted_at is null

union all

-- בדיקה 2: הוצאה בלי חשבונית ספק — עם המע"מ שמפוספס
select
  'expense_without_invoice',
  t.id, t.date_cash, t.amount_gross, abs(t.vat_amount), t.counterparty, t.description
from transactions t
where t.nature = 'expense' and t.certainty = 'actual'
  and t.invoice_status in ('missing', 'unknown')
  and t.deleted_at is null;

comment on view v_invoice_gaps is
  'SPEC §4.3 — שלוש הבדיקות. vat_at_risk הוא כמה כסף מפסידים אם החשבונית לא תושג.';

-- ─── db/views/003_addendum.sql ─────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- Views — ADDENDUM: גביה, צ'קליסט ביצוע, בריאות המערכת
-- ADDENDUM ב.5, ב.6, חלק ג
-- ════════════════════════════════════════════════════════════════════════════

/*
 * v_collections_aging — ADDENDUM ב.6.
 * גיול היתרות הפתוחות, עם הפיצול לוודאי/פוטנציאלי.
 */
create or replace view v_collections as
select
  b.deal_id,
  b.client_name,
  b.division,
  b.collection_status,
  b.open_balance_net                                   as open_amount,
  b.open_committed,
  b.open_expected_weighted                             as open_expected,
  due.due_date,
  greatest(0, current_date - due.due_date)             as days_overdue,
  case
    when due.due_date is null then '0-30'
    when current_date - due.due_date <= 30 then '0-30'
    when current_date - due.due_date <= 60 then '31-60'
    when current_date - due.due_date <= 90 then '61-90'
    else '90+'
  end                                                  as aging_bucket,
  d.owner_user_id,
  d.stage,
  d.status
from v_deal_balance b
join deals d on d.id = b.deal_id
left join lateral (
  select min(p.expected_date) as due_date
  from deal_payments_plan p
  where p.deal_id = b.deal_id and p.matched_tx_id is null and p.deleted_at is null
) due on true
where b.open_balance_net > 0
  and d.status not in ('lost', 'cancelled')
  and d.deleted_at is null;

create or replace view v_collections_aging as
select
  division,
  aging_bucket,
  sum(open_amount)      as amount,
  sum(open_committed)   as committed,
  sum(open_expected)    as expected,
  count(*)              as deal_count
from v_collections
group by division, aging_bucket;

comment on view v_collections_aging is
  'ADDENDUM ב.6 — 4 קוביות הגיול במסך 20.';

/*
 * v_execution_pipeline — ADDENDUM ב.5.
 * "מה צריך כדי לבצע ולקבל כספים" — הפריט הבא שחסר לכל תיק.
 */
create or replace view v_execution_pipeline as
select
  c.deal_id,
  d.client_name,
  d.division,
  d.owner_user_id,
  b.open_balance_net                            as amount_at_stake,
  nxt.label                                     as next_missing,
  nxt.status                                    as next_status,
  nxt.blocked_reason,
  nxt.status_since,
  case when nxt.status_since is not null
       then current_date - nxt.status_since end as stuck_days,
  round(
    100.0 * count(*) filter (where c.status = 'done')
    / nullif(count(*) filter (where c.status <> 'n/a'), 0), 2
  )                                             as completion_pct
from deal_checklist_items c
join deals d on d.id = c.deal_id
join v_deal_balance b on b.deal_id = c.deal_id
left join lateral (
  -- הפריט הבא שחסר: הראשון בסדר שאינו done ואינו n/a.
  select i.label, i.status, i.blocked_reason, i.status_since
  from deal_checklist_items i
  where i.deal_id = c.deal_id
    and i.status not in ('done', 'n/a')
    and i.deleted_at is null
  order by i.sort_order
  limit 1
) nxt on true
where c.deleted_at is null
  and d.deleted_at is null
  and nxt.label is not null          -- תיק שהושלם אינו ברשימה
group by c.deal_id, d.client_name, d.division, d.owner_user_id,
         b.open_balance_net, nxt.label, nxt.status, nxt.blocked_reason, nxt.status_since;

comment on view v_execution_pipeline is
  'ADDENDUM ב.5 — עונה על "מה צריך כדי לבצע ולקבל כספים", ברמת תיק.';

/* פילוח החברה לפי הפריט החוסם — "60% מהם מחכים למסמכי לקוח". */
create or replace view v_execution_blockers as
select
  next_missing                                   as blocker,
  count(*)                                       as deal_count,
  sum(amount_at_stake)                           as amount,
  round(100.0 * sum(amount_at_stake)
        / nullif(sum(sum(amount_at_stake)) over (), 0), 2) as pct_of_total
from v_execution_pipeline
group by next_missing;

/*
 * v_system_health — ADDENDUM חלק ג.
 * "מסך בריאות המערכת בהגדרות מציג את 7 הימים האחרונים."
 */
create or replace view v_system_health as
select
  job_name,
  count(*)                                             as runs_7d,
  count(*) filter (where status = 'succeeded')         as succeeded,
  count(*) filter (where status = 'failed')            as failed,
  max(started_at)                                      as last_run_at,
  max(started_at) filter (where status = 'succeeded')  as last_success_at,
  (array_agg(error order by started_at desc)
     filter (where error is not null))[1]              as last_error
from scheduled_jobs_log
where started_at > now() - interval '7 days'
group by job_name;

/* התראות פעילות, ללא המושהות — מזין את קוביית "דורש טיפול" (ב.8). */
create or replace view v_active_alerts as
select *
from alerts
where resolved_at is null
  and deleted_at is null
  and (snoozed_until is null or snoozed_until <= current_date);

/* ADDENDUM ב.11 — "יותר מ-5 קריטיות → תזרים במצב סיכון". */
create or replace view v_risk_mode as
select
  count(*) filter (where severity = 'critical') as critical_count,
  count(*) filter (where severity = 'critical')
    > coalesce((select (value #>> '{}')::int from settings
                where key = 'risk_mode_critical_count'), 5) as is_risk_mode
from v_active_alerts;

-- ─── db/views/004_collections.sql ──────────────────────────────────────
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

-- ─── db/views/005_gaps.sql ─────────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- מסך 12 — פערי חשבוניות (SPEC §4.3 בדיקה 3): 12 חודשים אחורה, לפי חודש.
-- מסך 10 — מע"מ נשען על v_vat הקיים (§3.1).
-- ════════════════════════════════════════════════════════════════════════════

/*
 * v_invoice_gaps_by_month — "טבלת פערים לפי חודש: הכנסות בלי מסמך / מסמכים בלי
 * כסף / הוצאות בלי חשבונית / הפרשי סכום". זה הפלט שנשלח לרו"ח.
 */
create or replace view v_invoice_gaps_by_month as
with months as (
  select to_char(gs, 'YYYY-MM') as month
  from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') gs
),
gaps as (
  select g.gap_kind, to_char(g.date, 'YYYY-MM') as month, g.amount, g.vat_at_risk
  from v_invoice_gaps g
)
select
  m.month,
  count(*) filter (where g.gap_kind = 'income_without_invoice')                  as income_without_invoice,
  coalesce(sum(g.amount) filter (where g.gap_kind = 'income_without_invoice'), 0) as income_without_invoice_amount,
  count(*) filter (where g.gap_kind = 'invoice_without_receipt')                 as invoice_without_receipt,
  coalesce(sum(g.amount) filter (where g.gap_kind = 'invoice_without_receipt'), 0) as invoice_without_receipt_amount,
  count(*) filter (where g.gap_kind = 'expense_without_invoice')                 as expense_without_invoice,
  coalesce(sum(g.amount) filter (where g.gap_kind = 'expense_without_invoice'), 0) as expense_without_invoice_amount,
  coalesce(sum(g.vat_at_risk) filter (where g.gap_kind = 'expense_without_invoice'), 0) as vat_at_risk,
  count(*)                                                                       as total_gaps
from months m
left join gaps g on g.month = m.month
group by m.month
order by m.month;

comment on view v_invoice_gaps_by_month is
  'SPEC §4.3 בדיקה 3 — דוח הפערים ל-12 חודשים. זה הקריטריון של שלב 6.';

/*
 * v_vat_periods — מסך 10: חבות לפי תקופת דיווח, חודשית או דו-חודשית.
 * התקופה נקבעת לפי settings.vat_bimonthly; ברירת מחדל חודשית.
 */
create or replace view v_vat_periods as
with cfg as (
  select coalesce((select (value #>> '{}')::boolean from settings where key = 'vat_bimonthly'), false) as bimonthly
),
base as (
  select
    v.vat_month,
    case when (select bimonthly from cfg)
      -- דו-חודשי: ינואר–פברואר מדווחים יחד כ"01-02".
      then substring(v.vat_month, 1, 5) ||
           lpad((((extract(month from (v.vat_month || '-01')::date)::int + 1) / 2) * 2 - 1)::text, 2, '0') || '/' ||
           lpad((((extract(month from (v.vat_month || '-01')::date)::int + 1) / 2) * 2)::text, 2, '0')
      else v.vat_month end as period,
    v.division, v.output_vat, v.input_vat_claimable, v.input_vat_missing_invoice, v.missing_invoice_count, v.liability
  from v_vat v
)
select
  period,
  min(vat_month)                                as first_month,
  max(vat_month)                                as last_month,
  coalesce(sum(output_vat), 0)                  as output_vat,
  coalesce(sum(input_vat_claimable), 0)         as input_vat_claimable,
  coalesce(sum(input_vat_missing_invoice), 0)   as input_vat_missing_invoice,
  coalesce(sum(missing_invoice_count), 0)::int  as missing_invoice_count,
  coalesce(sum(liability), 0)                   as liability,
  (select bimonthly from cfg)                   as bimonthly
from base
group by period
order by period desc;

comment on view v_vat_periods is
  'SPEC §3.1 — חבות מע"מ לפי תקופת דיווח (חודשית/דו-חודשית לפי ההגדרה).';

-- ─── db/views/006_realestate.sql ───────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- מסך 8 — משיכות שותפים נדל"ן (SPEC §3.5) · מסך 9 — הכנסות פרייבט (§2.1).
--
-- §3.5 שונה מ-§3.2 בשתי נקודות, וזה מה שה-views האלה מקודדים:
--   • אין דרישת "מאושר ע"י ניסים" בנדל"ן.
--   • ההכנסה נספרת בלי דרישת deal_id (בניגוד ל-v_pnl_distributable).
-- זהות מלאה מול lib/rules/realestate.ts — נבדקת ב-db/tests/003_realestate.sql.
-- ════════════════════════════════════════════════════════════════════════════

/*
 * v_realestate_profit — רווח לחלוקה בנדל"ן לפי חודש.
 *   income actual (realestate + shared×split) − expense actual deductible.
 */
create or replace view v_realestate_profit as
select
  c.month_cash                                                              as month,
  coalesce(sum(c.amount_net) filter (where c.nature = 'income'), 0)         as income,
  abs(coalesce(sum(c.amount_net) filter (
    where c.nature = 'expense' and c.deductible is true), 0))               as expenses,
  coalesce(sum(c.amount_net) filter (where c.nature = 'income'), 0)
    - abs(coalesce(sum(c.amount_net) filter (
        where c.nature = 'expense' and c.deductible is true), 0))           as profit
from v_tx_classified c
where c.division = 'realestate' and c.certainty = 'actual'
  and c.nature in ('income', 'expense')
group by c.month_cash;

comment on view v_realestate_profit is
  'SPEC §3.5 — רווח לחלוקה בנדל"ן. בלי דרישת אישור ובלי דרישת deal_id.';

/*
 * v_realestate_profit_year — אותו דבר לפי שנה, כי היעד השוויוני הוא YTD.
 */
create or replace view v_realestate_profit_year as
select
  substring(month, 1, 4)  as year,
  sum(income)             as income,
  sum(expenses)           as expenses,
  sum(profit)             as profit
from v_realestate_profit
group by substring(month, 1, 4);

/*
 * v_partner_positions — לכל שותף נדל"ן, לכל שנה:
 *   משיכה בפועל (salary + management_fee + dividend) · יעד שוויוני (רווח ÷ שותפים)
 *   · סטייה · חו"ז בעלים (owner_loan − loan_repayment).
 *
 * השנים נלקחות מאיחוד השנים שיש בהן רווח ושיש בהן משיכה, כדי ששנה עם משיכות
 * בלי רווח (או להפך) לא תיעלם מהמסך.
 */
create or replace view v_partner_positions as
with years as (
  select year from v_realestate_profit_year
  union
  select to_char(d.date, 'YYYY') from partner_draws d
  join partners p on p.id = d.partner_id
  where d.deleted_at is null and p.division = 'realestate' and p.deleted_at is null
  union
  -- השנה הנוכחית תמיד מופיעה: מסך שמראה "אין שותפים" כשעוד לא קרה כלום
  -- הוא מסך שבור, לא מסך ריק.
  select to_char(current_date, 'YYYY')
),
active_partners as (
  select id, name, share_pct, pay_method, investor_loan_opening
  from partners
  where division = 'realestate' and active and deleted_at is null
),
n as (select count(*)::numeric as cnt from active_partners),
draws as (
  select
    p.id as partner_id,
    to_char(d.date, 'YYYY') as year,
    coalesce(sum(abs(d.amount)) filter (
      where d.type in ('salary', 'management_fee', 'dividend')), 0) as drawn,
    coalesce(sum(abs(d.amount)) filter (where d.type = 'owner_loan'), 0)      as owner_loans,
    coalesce(sum(abs(d.amount)) filter (where d.type = 'loan_repayment'), 0)  as repayments,
    count(*) filter (where d.type in ('salary', 'management_fee', 'dividend'))::int as draw_count
  from active_partners p
  join partner_draws d on d.partner_id = p.id and d.deleted_at is null
  group by p.id, to_char(d.date, 'YYYY')
)
select
  y.year,
  p.id                                                        as partner_id,
  p.name,
  p.pay_method,
  coalesce(pr.profit, 0)                                      as distributable_profit,
  -- היעד השוויוני: רווח ÷ מספר השותפים הפעילים (33/33/33 כששלושה).
  round(coalesce(pr.profit, 0) / nullif((select cnt from n), 0), 2) as target,
  coalesce(d.drawn, 0)                                        as drawn,
  coalesce(d.drawn, 0)
    - round(coalesce(pr.profit, 0) / nullif((select cnt from n), 0), 2) as variance,
  coalesce(d.owner_loans, 0) - coalesce(d.repayments, 0)      as owner_loan_balance,
  coalesce(d.owner_loans, 0)                                  as owner_loans,
  coalesce(d.repayments, 0)                                   as loan_repayments,
  coalesce(d.draw_count, 0)                                   as draw_count,
  p.investor_loan_opening
from years y
cross join active_partners p
left join v_realestate_profit_year pr on pr.year = y.year
left join draws d on d.partner_id = p.id and d.year = y.year;

comment on view v_partner_positions is
  'SPEC §3.5 — 33/33/33: משיכה בפועל מול יעד שוויוני YTD, וחו"ז בעלים בנפרד.';

/*
 * v_investor_loan — חוב המשקיע (יוני, §3.5), "מוצג עם קצב ירידה".
 * יתרת הפתיחה יושבת על השותף; 0 = טרם הוזנה (שאלה #8).
 */
create or replace view v_investor_loan as
with repay as (
  select
    d.partner_id,
    coalesce(sum(abs(d.amount)), 0)                         as repaid,
    count(distinct to_char(d.date, 'YYYY-MM'))::int         as months_with_repayment,
    max(d.date)                                             as last_repayment
  from partner_draws d
  where d.type = 'loan_repayment' and d.deleted_at is null
  group by d.partner_id
)
select
  p.id                                                      as partner_id,
  p.name,
  p.investor_loan_opening                                   as opening_balance,
  coalesce(r.repaid, 0)                                     as repaid,
  p.investor_loan_opening - coalesce(r.repaid, 0)           as balance,
  case when coalesce(r.months_with_repayment, 0) > 0
       then round(r.repaid / r.months_with_repayment, 2) end as average_monthly_repayment,
  case when coalesce(r.months_with_repayment, 0) > 0 and r.repaid > 0
       then ceil((p.investor_loan_opening - r.repaid) /
                 (r.repaid / r.months_with_repayment))::int end as months_to_clear,
  r.last_repayment
from partners p
left join repay r on r.partner_id = p.id
where p.deleted_at is null and p.investor_loan_opening > 0;

comment on view v_investor_loan is
  'SPEC §3.5 — חוב המשקיע: פתיחה פחות החזרים, עם קצב ההחזר החודשי הממוצע.';

/*
 * v_cash_discount — נכיון מזומן. §3.5: "מוצג בנפרד בדוח (לא מוסתר)".
 */
create or replace view v_cash_discount as
select
  c.tx_id,
  c.division,
  c.month_cash                as month,
  c.date_cash                 as date,
  c.counterparty,
  c.description,
  c.amount_net,
  c.amount_gross
from v_tx_classified c
where c.cash_discount is true and c.nature = 'income' and c.certainty = 'actual';

comment on view v_cash_discount is
  'SPEC §3.5 — נכיון מזומן מוצג בנפרד ולעולם לא מוסתר מהדוח.';

/*
 * v_private_income — מסך 9. §2.1: נפרד לחלוטין מהחברה; הטבלה לא נוגעת
 * ב-transactions ולא ב-v_tx_allocated, וגם ה-view הזה לא.
 */
create or replace view v_private_income as
select
  i.id,
  i.fund_name,
  i.deal_ref,
  i.deal_amount,
  i.threshold_rule,
  i.pct,
  i.amount_net,
  i.vat_amount,
  i.amount_net + i.vat_amount            as amount_gross,
  i.split_dan,
  i.split_nissim,
  round(i.amount_net * i.split_dan, 2)    as dan_amount,
  round(i.amount_net * i.split_nissim, 2) as nissim_amount,
  i.received_date,
  i.received_to,
  i.status,
  i.note,
  case when i.received_date is not null then to_char(i.received_date, 'YYYY-MM') end as month_received
from private_income i
where i.deleted_at is null;

/*
 * v_private_income_summary — צפוי מול התקבל, ולכל אחד מהשניים.
 * מה שמתקבל מתחלק לפי ה-split של אותה שורה, ולא לפי ממוצע.
 */
create or replace view v_private_income_summary as
select
  status,
  count(*)::int             as rows_count,
  sum(amount_net)           as amount_net,
  sum(vat_amount)           as vat_amount,
  sum(dan_amount)           as dan_amount,
  sum(nissim_amount)        as nissim_amount
from v_private_income
group by status;

comment on view v_private_income is
  'SPEC §2.1, מסך 9 — הכנסות פרייבט. לא מצטרף לשום שאילתה עסקית.';

-- ─── db/seed/000_bootstrap.sql ─────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- Bootstrap — הגדרות מינימליות כדי שהמערכת תוכל לקלוט נתונים.
-- זו קונפיגורציה (SPEC §5 מסך 18), לא נתוני דמו: אין כאן אף סכום עסקי.
-- שלב 0 (§9) אמור להחליף את הערכים האלה בערכים האמיתיים (ח.פ, שם חשבון, וכו').
-- ════════════════════════════════════════════════════════════════════════════

insert into users (id, email, full_name, role)
values ('00000000-0000-4000-8000-000000000001', 'danbusiness1000@gmail.com', 'דן', 'admin')
on conflict (email) do nothing;

insert into settings (key, value, description) values
  ('vat_rate',               '0.18'::jsonb,                          'SPEC §3.1 — שיעור מע"מ'),
  ('default_division_split', '{"finance":0.8,"realestate":0.2}',     'SPEC §1.2 — הדס 80/20'),
  ('nissim_share_pct',       '0.5'::jsonb,                           'SPEC §3.3 — חלק ניסים'),
  ('monthly_profit_target',  '500000'::jsonb,                        'SPEC §5.1 — קו יעד חודשי (מהקובץ: הגדרות!B6)'),
  ('yearly_profit_target',   '3000000'::jsonb,                       'SPEC §5.1 — יעד שנתי (מהקובץ: הגדרות!B7)'),
  ('risk_mode_critical_count', '5'::jsonb,                           'ADDENDUM ב.11')
on conflict (key) do nothing;

insert into vat_rates (valid_from, rate) values ('2025-01-01', 0.18) on conflict (valid_from) do nothing;

-- SPEC §2.1 entities: א.ד.י הראל השקעות (ח.פ 516857083), D&D (ע.מ), עדן הובלות ובנייה
insert into entities (id, name, type, vat_id) values
  ('10000000-0000-4000-8000-000000000001', 'א.ד.י הראל השקעות', 'company', '516857083'),
  ('10000000-0000-4000-8000-000000000002', 'די.אנד.די עסקים (ע.מ)', 'sole_proprietor', null),
  ('10000000-0000-4000-8000-000000000003', 'עדן הובלות ובנייה', 'company', null)
on conflict (id) do nothing;

-- חשבון הבנק המשותף (SPEC §2.2 "חשבון אחד"). הבנק עצמו — שאלה פתוחה #1.
insert into accounts (id, entity_id, type, name, default_division)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'bank', 'עו"ש — החשבון המשותף', 'finance')
on conflict (id) do nothing;

-- שותפים (SPEC §2.1 partners)
insert into partners (id, name, division, share_pct, pay_method) values
  ('30000000-0000-4000-8000-000000000001', 'ניסים', 'finance',    0.5,     'invoice'),
  ('30000000-0000-4000-8000-000000000002', 'דן',    'realestate', 0.33333, 'invoice'),
  ('30000000-0000-4000-8000-000000000003', 'אביב',  'realestate', 0.33333, 'invoice'),
  ('30000000-0000-4000-8000-000000000004', 'יוני',  'realestate', 0.33333, 'payslip')
on conflict (id) do nothing;

-- ─── db/seed/001_categories.sql ────────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- קטגוריות ברירת מחדל — SPEC §2.1 + מבנה ההוצאות הקבועות שדן פירט (18/09/2026)
--
-- זו *הגדרה* (רשימה סגורה שניתנת לעריכה במסך 18), לא נתוני דמו — SPEC §11.11
-- אוסר להמציא *מספרים*, לא שמות קטגוריות. אין כאן סכומים.
-- מפתחות חשבון (gi_account_key) לפי רשימת חשבונית ירוקה ב-SPEC §4.3.
-- ════════════════════════════════════════════════════════════════════════════

insert into categories (name, kind, gi_account_key, sort_order) values
  -- קבועות (SPEC §2.1 + דן)
  ('שיווק',                'fixed',    '1390', 10),
  ('קמפיינר',              'fixed',    '1390', 11),
  ('מנהל קמפיינים',        'fixed',    '1390', 12),
  ('מוקדנים / נציגי מוקד', 'fixed',    '3011', 13),
  ('שכר',                  'fixed',    '3011', 14),
  ('ביטוח לאומי מעסיק',    'fixed',    '3012', 15),
  ('שכירות משרד',          'fixed',    '3570', 16),
  ('ארנונה',               'fixed',    '3575', 17),
  ('משרד',                 'fixed',    '1390', 18),
  ('תוכנה ומערכות',        'fixed',    '3680', 19),
  ('תקשורת',               'fixed',    '3650', 20),
  ('רו"ח',                 'fixed',    '3540', 21),
  ('רשויות ואגרות',        'fixed',    '3575', 22),
  ('דמי ניהול',            'fixed',    '1390', 23),
  ('רכב יורם',             'fixed',    '3560', 24),
  ('הלוואה',               'fixed',    '1390', 25),
  ('כיבוד',                'fixed',    '3625', 26),
  ('נלוות',                'fixed',    '1390', 27),
  -- ישירות — על תיק (SPEC §2.1)
  ('לידים — אבינועם',      'direct',   '1390', 40),
  ('לידים — אלכס',         'direct',   '1390', 41),
  ('נסח טאבו',             'direct',   '1390', 42),
  ('שמאות',                'direct',   '1390', 43),
  ('עו"ד',                 'direct',   '1390', 44),
  ('דוח BDI / אשראי',      'direct',   '1390', 45),
  ('הנה"ח לקוח',           'direct',   '3540', 46),
  ('עמלת מכירה',           'direct',   '1390', 47),
  -- מסים ומע"מ — לא הוצאה (nature=vat/tax), אבל צריכות קטגוריה לסיווג
  ('מע"מ',                 'variable', '1390', 60),
  ('מס הכנסה / מקדמות',    'variable', '1390', 61),
  ('עמלות בנק',            'variable', '1390', 62),
  -- כללי
  ('שונות',                'variable', '1390', 90)
on conflict do nothing;

-- SPEC §4.1 — שורת אשראי שלא זוהתה נכנסת עם review_status=unknown_expense; הוצאה חייבת
-- קטגוריה (נספח ב #7), אז היא נכנסת לכאן עד שניסים/אביב עונים. לא מופיעה בבחירה הידנית.
insert into categories (name, kind, gi_account_key, sort_order, active) values
  ('לא מסווג — ממתין לתשובה', 'variable', '1390', 99, true)
on conflict do nothing;

-- ─── db/tests/000_guarantees.sql ───────────────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- בדיקות ה-DB: האם ההבטחות המבניות באמת נאכפות?
--
-- SPEC §11 מגדיר כמה כללים שחייבים להיאכף ברמת ה-DB ולא רק ב-UI.
-- הקובץ הזה מנסה *להפר* כל אחד מהם ונכשל אם ההפרה מצליחה.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- הכל בתוך טרנזקציה אחת שנגללת בסוף: הבדיקות לא משאירות שאריות.
begin;
set local app.current_user_id = '00000000-0000-4000-8000-000000000001';

do $$
declare
  ok boolean;
  acc uuid := (select id from accounts limit 1);
  cat uuid := (select id from categories limit 1);
  actor uuid := (select id from users limit 1);
begin
  perform set_config('app.current_user_id', actor::text, true);

  -- ── SPEC §11.5: מע"מ מחושב פעם אחת בכתיבה ונשמר ────────────────────────
  declare vat numeric; gross numeric; net numeric;
  begin
    insert into transactions (date_cash, account_id, amount_net, vat_mode, vat_rate,
                              nature, division, category_id, deductible)
    values ('2026-11-01', acc, -1000, 'excl', 0.18, 'expense', 'finance', cat, true)
    returning vat_amount, amount_gross into vat, gross;
    assert vat = -180.00,   'excl: מע"מ שגוי — ' || vat;
    assert gross = -1180.00, 'excl: ברוטו שגוי — ' || gross;

    insert into transactions (date_cash, account_id, amount_net, vat_mode, vat_rate,
                              nature, division, category_id, deductible)
    values ('2026-11-01', acc, -1180, 'incl', 0.18, 'expense', 'finance', cat, true)
    returning amount_net, vat_amount into net, vat;
    assert net = -1000.00, 'incl: נטו שגוי — ' || net;
    assert vat = -180.00,  'incl: מע"מ שגוי — ' || vat;
    raise notice '✓ §11.5 מע"מ מחושב ונשמר בכתיבה';
  end;

  -- ── SPEC §2.1: nature=advance חייב division=finance ────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division)
    values ('2026-11-02', acc, -5000, 'advance', 'realestate');
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§2.1 advance ב-realestate לא נחסם';
  raise notice '✓ §2.1 advance מוגבל ל-finance';

  -- ── SPEC §2.1: nature=draw חייב שותף ───────────────────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division)
    values ('2026-11-02', acc, -5000, 'draw', 'finance');
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§2.1 draw בלי שותף לא נחסם';
  raise notice '✓ §2.1 draw דורש שותף';

  -- ── SPEC §2.1 + נספח ב #7: הוצאה בלי קטגוריה ───────────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division, deductible)
    values ('2026-11-02', acc, -100, 'expense', 'finance', true);
    ok := false;
  exception when check_violation then null; end;
  assert ok, 'נספח ב #7 — הוצאה בלי קטגוריה לא נחסמה';
  raise notice '✓ נספח ב #7 הוצאה חייבת קטגוריה';

  -- ── SPEC §1.2: shared חייב מפתח חלוקה ──────────────────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division,
                              category_id, deductible)
    values ('2026-11-02', acc, -100, 'expense', 'shared', cat, true);
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§1.2 shared בלי מפתח חלוקה לא נחסם';
  raise notice '✓ §1.2 shared חייב מפתח חלוקה';

  -- ── SPEC §2.1: הכנסה חיובית, הוצאה שלילית ──────────────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division,
                              category_id, deductible)
    values ('2026-11-02', acc, 500, 'expense', 'finance', cat, true);
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§2.1 הוצאה חיובית לא נחסמה';
  raise notice '✓ §2.1 סימן הסכום תואם לטבע התנועה';

  -- ── SPEC §11.4: אין DELETE פיזי ────────────────────────────────────────
  ok := true;
  begin
    delete from transactions where date_cash = '2026-11-01';
    ok := false;
  exception when restrict_violation then null; end;
  assert ok, '§11.4 מחיקה פיזית לא נחסמה';
  raise notice '✓ §11.4 אין DELETE פיזי — soft delete בלבד';

  -- ── SPEC §1.7: יומן שינויים על הכל ─────────────────────────────────────
  declare audit_rows int;
  begin
    select count(*) into audit_rows
    from audit_log where table_name = 'transactions' and action = 'INSERT';
    assert audit_rows > 0, '§1.7 לא נרשמו שורות ביומן השינויים';
    raise notice '✓ §1.7 יומן שינויים נכתב (% שורות)', audit_rows;
  end;

  -- ── SPEC §11.8: תקופה נעולה נדחית ברמת ה-DB ────────────────────────────
  -- על DB טרי אין עדיין שורת תקופה, ו-update על 0 שורות לא נועל כלום —
  -- הבדיקה הייתה "עוברת" בלי לבדוק דבר. הבדיקה מייצרת את מה שהיא צריכה.
  insert into periods (division, year, month, status)
  values ('finance', 2026, 7, 'open')
  on conflict (division, year, month) do nothing;

  update periods
     set status = 'closed', closed_at = now(), snapshot_json = '{"test": true}'::jsonb
   where division = 'finance' and year = 2026 and month = 7;
  assert found, '§11.8 לא נמצאה תקופה לנעילה — הבדיקה לא יכלה לרוץ';

  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division,
                              category_id, deductible)
    values ('2026-07-15', acc, -100, 'expense', 'finance', cat, true);
    ok := false;
  exception when restrict_violation then null; end;
  assert ok, '§11.8 כתיבה לתקופה נעולה לא נדחתה';

  -- ועריכה של שורה קיימת בתקופה הנעולה
  ok := true;
  begin
    update transactions set description = 'ניסיון עריכה'
     where id = (select id from transactions
                  where date_cash between '2026-07-01' and '2026-07-31' limit 1);
    ok := false;
  exception when restrict_violation then null; end;
  raise notice '✓ §11.8 תקופה נעולה נדחית ברמת ה-DB';

  update periods set status = 'open', closed_at = null, snapshot_json = null
   where division = 'finance' and year = 2026 and month = 7;

  -- ── SPEC §11.9: ייבוא idempotent ───────────────────────────────────────
  insert into transactions (date_cash, account_id, amount_net, nature, division,
                            category_id, deductible, source, source_ref)
  values ('2026-11-03', acc, -250, 'expense', 'finance', cat, true, 'card_import', 'REF-1');
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division,
                              category_id, deductible, source, source_ref)
    values ('2026-11-03', acc, -250, 'expense', 'finance', cat, true, 'card_import', 'REF-1');
    ok := false;
  exception when unique_violation then null; end;
  assert ok, '§11.9 ייבוא כפול לא נחסם';
  raise notice '✓ §11.9 ייבוא idempotent — dedup לפי source_ref';

  -- ── SPEC §3.9: תקופות הסכם עבודה לא חופפות ─────────────────────────────
  declare emp uuid;
  begin
    insert into employees (name, pay_type, division_split, start_date)
    values ('בדיקה', 'payslip', '{"finance":1}'::jsonb, '2026-01-01') returning id into emp;
    insert into employment_terms (employee_id, valid_from, valid_to, base_mode, hourly_rate)
    values (emp, '2026-01-01', '2026-06-30', 'hourly', 50);
    ok := true;
    begin
      insert into employment_terms (employee_id, valid_from, valid_to, base_mode, hourly_rate)
      values (emp, '2026-06-01', '2026-12-31', 'hourly', 60);
      ok := false;
    exception when exclusion_violation then null; end;
    assert ok, '§3.9 הסכמי עבודה חופפים לא נחסמו';
    raise notice '✓ §3.9 תקופות הסכם לא חופפות';
  end;

  -- ── SPEC §2.1: תקופה סגורה חייבת תצלום ─────────────────────────────────
  ok := true;
  begin
    update periods set status = 'closed', closed_at = now(), snapshot_json = null
     where division = 'finance' and year = 2026 and month = 7;
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§2.1 תקופה סגורה בלי תצלום לא נחסמה';
  raise notice '✓ §2.1 תקופה סגורה חייבת תצלום';

  -- ── 007: jsonb חייב להיות אובייקט, לא מחרוזת JSON ─────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division, division_split, category_id, deductible)
    values ('2026-11-05', acc, -100, 'expense', 'shared', to_jsonb('{"finance":0.8}'::text), cat, true);
    ok := false;
  exception when check_violation then null; end;
  assert ok, '007 — division_split כמחרוזת JSON לא נחסם';
  ok := true;
  begin
    insert into settings (key, value) values ('__test_double', to_jsonb('{"a":1}'::text));
    ok := false;
  exception when check_violation then null; end;
  assert ok, '007 — settings עם מחרוזת JSON לא נחסם';
  raise notice '✓ 007 jsonb מחזיק אובייקט, לא מחרוזת JSON (מפתח חלוקה לא נופל בשקט)';

  -- ── 008: ייבוא אשראי — אותה שורה לא נכנסת פעמיים לאותה אצווה; הוצאה מאושרת חייבת קטגוריה ──
  declare batch uuid;
  begin
    insert into import_batches (source, file_name, file_hash, account_id)
    values ('card_import', 'test.csv', 'hash-test', acc) returning id into batch;
    insert into import_rows (batch_id, row_index, source_ref, date, merchant, amount)
    values (batch, 1, 'card:x:1', '2026-11-01', 'TEST', -10);
    ok := true;
    begin
      insert into import_rows (batch_id, row_index, source_ref, date, merchant, amount)
      values (batch, 2, 'card:x:1', '2026-11-01', 'TEST', -10);
      ok := false;
    exception when unique_violation then null; end;
    assert ok, '008 — שורת ייבוא כפולה באותה אצווה לא נחסמה';
    ok := true;
    begin
      update import_rows set decision = 'approved' where batch_id = batch;
      ok := false;
    exception when check_violation then null; end;
    assert ok, '008 — הוצאה מאושרת בלי קטגוריה לא נחסמה';
    raise notice '✓ 008 ייבוא אשראי: dedup בתוך אצווה, הוצאה מאושרת חייבת קטגוריה';
  end;

  raise notice '';
  raise notice 'כל ההבטחות המבניות נאכפות.';
end;
$$;

rollback;
