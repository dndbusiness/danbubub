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
