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
