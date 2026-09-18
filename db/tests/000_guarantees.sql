-- ════════════════════════════════════════════════════════════════════════════
-- בדיקות ה-DB: האם ההבטחות המבניות באמת נאכפות?
--
-- SPEC §11 מגדיר כמה כללים שחייבים להיאכף ברמת ה-DB ולא רק ב-UI.
-- הקובץ הזה מנסה *להפר* כל אחד מהם ונכשל אם ההפרה מצליחה.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- הכל בתוך טרנזקציה אחת שנגללת בסוף: הבדיקות לא משאירות שאריות.
begin;
set local app.current_user_id = '00000000-0000-4000-8000-000000000001';

do $$
declare
  ok boolean;
  acc uuid := (select id from accounts limit 1);
  cat uuid := (select id from categories limit 1);
  actor uuid := (select id from users limit 1);
begin
  perform set_config('app.current_user_id', actor::text, true);

  -- ── SPEC §11.5: מע"מ מחושב פעם אחת בכתיבה ונשמר ────────────────────────
  declare vat numeric; gross numeric; net numeric;
  begin
    insert into transactions (date_cash, account_id, amount_net, vat_mode, vat_rate,
                              nature, division, category_id, deductible)
    values ('2026-11-01', acc, -1000, 'excl', 0.18, 'expense', 'finance', cat, true)
    returning vat_amount, amount_gross into vat, gross;
    assert vat = -180.00,   'excl: מע"מ שגוי — ' || vat;
    assert gross = -1180.00, 'excl: ברוטו שגוי — ' || gross;

    insert into transactions (date_cash, account_id, amount_net, vat_mode, vat_rate,
                              nature, division, category_id, deductible)
    values ('2026-11-01', acc, -1180, 'incl', 0.18, 'expense', 'finance', cat, true)
    returning amount_net, vat_amount into net, vat;
    assert net = -1000.00, 'incl: נטו שגוי — ' || net;
    assert vat = -180.00,  'incl: מע"מ שגוי — ' || vat;
    raise notice '✓ §11.5 מע"מ מחושב ונשמר בכתיבה';
  end;

  -- ── SPEC §2.1: nature=advance חייב division=finance ────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division)
    values ('2026-11-02', acc, -5000, 'advance', 'realestate');
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§2.1 advance ב-realestate לא נחסם';
  raise notice '✓ §2.1 advance מוגבל ל-finance';

  -- ── SPEC §2.1: nature=draw חייב שותף ───────────────────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division)
    values ('2026-11-02', acc, -5000, 'draw', 'finance');
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§2.1 draw בלי שותף לא נחסם';
  raise notice '✓ §2.1 draw דורש שותף';

  -- ── SPEC §2.1 + נספח ב #7: הוצאה בלי קטגוריה ───────────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division, deductible)
    values ('2026-11-02', acc, -100, 'expense', 'finance', true);
    ok := false;
  exception when check_violation then null; end;
  assert ok, 'נספח ב #7 — הוצאה בלי קטגוריה לא נחסמה';
  raise notice '✓ נספח ב #7 הוצאה חייבת קטגוריה';

  -- ── SPEC §1.2: shared חייב מפתח חלוקה ──────────────────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division,
                              category_id, deductible)
    values ('2026-11-02', acc, -100, 'expense', 'shared', cat, true);
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§1.2 shared בלי מפתח חלוקה לא נחסם';
  raise notice '✓ §1.2 shared חייב מפתח חלוקה';

  -- ── SPEC §2.1: הכנסה חיובית, הוצאה שלילית ──────────────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division,
                              category_id, deductible)
    values ('2026-11-02', acc, 500, 'expense', 'finance', cat, true);
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§2.1 הוצאה חיובית לא נחסמה';
  raise notice '✓ §2.1 סימן הסכום תואם לטבע התנועה';

  -- ── SPEC §11.4: אין DELETE פיזי ────────────────────────────────────────
  ok := true;
  begin
    delete from transactions where date_cash = '2026-11-01';
    ok := false;
  exception when restrict_violation then null; end;
  assert ok, '§11.4 מחיקה פיזית לא נחסמה';
  raise notice '✓ §11.4 אין DELETE פיזי — soft delete בלבד';

  -- ── SPEC §1.7: יומן שינויים על הכל ─────────────────────────────────────
  declare audit_rows int;
  begin
    select count(*) into audit_rows
    from audit_log where table_name = 'transactions' and action = 'INSERT';
    assert audit_rows > 0, '§1.7 לא נרשמו שורות ביומן השינויים';
    raise notice '✓ §1.7 יומן שינויים נכתב (% שורות)', audit_rows;
  end;

  -- ── SPEC §11.8: תקופה נעולה נדחית ברמת ה-DB ────────────────────────────
  update periods
     set status = 'closed', closed_at = now(), snapshot_json = '{"test": true}'::jsonb
   where division = 'finance' and year = 2026 and month = 7;

  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division,
                              category_id, deductible)
    values ('2026-07-15', acc, -100, 'expense', 'finance', cat, true);
    ok := false;
  exception when restrict_violation then null; end;
  assert ok, '§11.8 כתיבה לתקופה נעולה לא נדחתה';

  -- ועריכה של שורה קיימת בתקופה הנעולה
  ok := true;
  begin
    update transactions set description = 'ניסיון עריכה'
     where id = (select id from transactions
                  where date_cash between '2026-07-01' and '2026-07-31' limit 1);
    ok := false;
  exception when restrict_violation then null; end;
  raise notice '✓ §11.8 תקופה נעולה נדחית ברמת ה-DB';

  update periods set status = 'open', closed_at = null, snapshot_json = null
   where division = 'finance' and year = 2026 and month = 7;

  -- ── SPEC §11.9: ייבוא idempotent ───────────────────────────────────────
  insert into transactions (date_cash, account_id, amount_net, nature, division,
                            category_id, deductible, source, source_ref)
  values ('2026-11-03', acc, -250, 'expense', 'finance', cat, true, 'card_import', 'REF-1');
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division,
                              category_id, deductible, source, source_ref)
    values ('2026-11-03', acc, -250, 'expense', 'finance', cat, true, 'card_import', 'REF-1');
    ok := false;
  exception when unique_violation then null; end;
  assert ok, '§11.9 ייבוא כפול לא נחסם';
  raise notice '✓ §11.9 ייבוא idempotent — dedup לפי source_ref';

  -- ── SPEC §3.9: תקופות הסכם עבודה לא חופפות ─────────────────────────────
  declare emp uuid;
  begin
    insert into employees (name, pay_type, division_split, start_date)
    values ('בדיקה', 'payslip', '{"finance":1}'::jsonb, '2026-01-01') returning id into emp;
    insert into employment_terms (employee_id, valid_from, valid_to, base_mode, hourly_rate)
    values (emp, '2026-01-01', '2026-06-30', 'hourly', 50);
    ok := true;
    begin
      insert into employment_terms (employee_id, valid_from, valid_to, base_mode, hourly_rate)
      values (emp, '2026-06-01', '2026-12-31', 'hourly', 60);
      ok := false;
    exception when exclusion_violation then null; end;
    assert ok, '§3.9 הסכמי עבודה חופפים לא נחסמו';
    raise notice '✓ §3.9 תקופות הסכם לא חופפות';
  end;

  -- ── SPEC §2.1: תקופה סגורה חייבת תצלום ─────────────────────────────────
  ok := true;
  begin
    update periods set status = 'closed', closed_at = now(), snapshot_json = null
     where division = 'finance' and year = 2026 and month = 7;
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§2.1 תקופה סגורה בלי תצלום לא נחסמה';
  raise notice '✓ §2.1 תקופה סגורה חייבת תצלום';

  -- ── 007: jsonb חייב להיות אובייקט, לא מחרוזת JSON ─────────────────────
  ok := true;
  begin
    insert into transactions (date_cash, account_id, amount_net, nature, division, division_split, category_id, deductible)
    values ('2026-11-05', acc, -100, 'expense', 'shared', to_jsonb('{"finance":0.8}'::text), cat, true);
    ok := false;
  exception when check_violation then null; end;
  assert ok, '007 — division_split כמחרוזת JSON לא נחסם';
  ok := true;
  begin
    insert into settings (key, value) values ('__test_double', to_jsonb('{"a":1}'::text));
    ok := false;
  exception when check_violation then null; end;
  assert ok, '007 — settings עם מחרוזת JSON לא נחסם';
  raise notice '✓ 007 jsonb מחזיק אובייקט, לא מחרוזת JSON (מפתח חלוקה לא נופל בשקט)';

  -- ── 008: ייבוא אשראי — אותה שורה לא נכנסת פעמיים לאותה אצווה; הוצאה מאושרת חייבת קטגוריה ──
  declare batch uuid;
  begin
    insert into import_batches (source, file_name, file_hash, account_id)
    values ('card_import', 'test.csv', 'hash-test', acc) returning id into batch;
    insert into import_rows (batch_id, row_index, source_ref, date, merchant, amount)
    values (batch, 1, 'card:x:1', '2026-11-01', 'TEST', -10);
    ok := true;
    begin
      insert into import_rows (batch_id, row_index, source_ref, date, merchant, amount)
      values (batch, 2, 'card:x:1', '2026-11-01', 'TEST', -10);
      ok := false;
    exception when unique_violation then null; end;
    assert ok, '008 — שורת ייבוא כפולה באותה אצווה לא נחסמה';
    ok := true;
    begin
      update import_rows set decision = 'approved' where batch_id = batch;
      ok := false;
    exception when check_violation then null; end;
    assert ok, '008 — הוצאה מאושרת בלי קטגוריה לא נחסמה';
    raise notice '✓ 008 ייבוא אשראי: dedup בתוך אצווה, הוצאה מאושרת חייבת קטגוריה';
  end;

  raise notice '';
  raise notice 'כל ההבטחות המבניות נאכפות.';
end;
$$;

rollback;
