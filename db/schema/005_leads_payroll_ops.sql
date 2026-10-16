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
