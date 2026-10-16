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
