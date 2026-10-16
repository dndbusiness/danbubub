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
