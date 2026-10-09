-- ════════════════════════════════════════════════════════════════════════════
-- 015 — מסמכי ה-CRM (הלידים, הלקוחות, המשימות, "הכר את הלקוח" …) על השרת.
--
-- ה-CRM שנבנה כדף ב-Claude שומר כל רשומה כמסמך JSON באוסף (clients/…, leads/…).
-- כדי שאותו דף ירוץ על השרת בלי לשכתב אותו, השרת שומר את אותם מסמכים כמו שהם:
-- אוסף + מזהה + אובייקט. זה שלב המעבר (שכפול → מעבר); הטבלאות המנורמלות של
-- האפיון (deals, transactions …) נשארות המקור לכספים ויתחברו בהמשך.
--
-- seq — מונה עולה לכל כתיבה. הדף מושך "מה השתנה מאז seq X" במקום האזנה בזמן אמת.
-- source — 'mirror' = הגיע מהגיבוי של הדף ב-Claude (בשלב השכפול נדרס כל בוקר);
--          'app'    = נכתב במערכת עצמה.
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists crm_docs_seq;

create table crm_docs (
  coll        text not null check (coll ~ '^[A-Za-z0-9_-]{1,64}$'),
  doc_id      text not null check (length(doc_id) between 1 and 200 and doc_id !~ '/'),
  -- מזהה אחד לשורה — audit_log רושם את id
  id          text generated always as (coll || '/' || doc_id) stored,
  -- הנחיית jsonb (007): אובייקט, לעולם לא מחרוזת JSON
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  seq         bigint not null default nextval('crm_docs_seq'),
  source      text not null default 'app' check (source in ('app', 'mirror')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references users(id),
  deleted_at  timestamptz,
  primary key (coll, doc_id)
);

create index crm_docs_seq_idx on crm_docs (seq);

select install_standard_triggers('crm_docs');

comment on table crm_docs is
  'מסמכי ה-CRM כמו בדף של Claude (אוסף/מזהה → אובייקט). seq למשיכת שינויים; מחיקה = deleted_at.';
