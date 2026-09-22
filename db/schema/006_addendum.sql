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
