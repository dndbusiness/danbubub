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
