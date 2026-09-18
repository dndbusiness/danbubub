-- ════════════════════════════════════════════════════════════════════════════
-- 014 — שלב 7: נדל"ן. משיכות שותפים (§3.5), חו"ז בעלים, חוב המשקיע.
--
-- הטבלאות עצמן (partners, partner_draws, private_income) קיימות מ-004.
-- כאן נוסף מה שחסר כדי שמסך 8 יעבוד: יתרת פתיחה של הלוואת משקיע, ותיעוד
-- מפורש של מה נספר כמשיכה מול היעד.
-- ════════════════════════════════════════════════════════════════════════════

/*
 * SPEC §3.5 — "חוב_ליוני = 200,000 (פתיחה) − Σ repayments → מוצג עם קצב ירידה".
 * היתרה יושבת על השותף ולא בהגדרות, כי היא נתון של אדם ולא של המערכת, והיא
 * חייבת להיכנס ליומן השינויים כמו כל נתון כספי אחר.
 *
 * ברירת המחדל 0 ולא 200,000 בכוונה: את הסכום מזין דן במסך (שאלה פתוחה #8 —
 * מקור החוב וקצב ההחזר). המערכת לא כותבת לעצמה מספר שלא אושר.
 */
alter table partners
  add column if not exists investor_loan_opening numeric(14,2) not null default 0,
  add column if not exists investor_loan_note    text;

do $$
begin
  alter table partners add constraint partners_investor_loan_nonneg
    check (investor_loan_opening >= 0);
exception when duplicate_object then null; end;
$$;

comment on column partners.investor_loan_opening is
  'SPEC §3.5 — יתרת פתיחה של הלוואת משקיע (יוני: 200,000 לפי האפיון). 0 = טרם הוזנה.';

-- ההחזרים והלוואות הבעלים נשלפים לפי שותף ותאריך בכל טעינה של מסך 8.
create index if not exists partner_draws_type_idx on partner_draws (type, date)
  where deleted_at is null;

comment on column partner_draws.type is
  'SPEC §3.5 — salary / management_fee / dividend נספרים כמשיכה מול היעד. '
  'owner_loan ו-loan_repayment הם חו"ז ולא משיכה.';

comment on column private_income.split_dan is
  'SPEC §2.1 — הכנסות פרייבט נפרדות לחלוטין מהחברה. הטבלה הזו לא מצטרפת '
  'לשום שאילתה של transactions, וגם לא ל-v_tx_allocated.';
