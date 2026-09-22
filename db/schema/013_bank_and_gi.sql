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
