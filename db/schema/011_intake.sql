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
