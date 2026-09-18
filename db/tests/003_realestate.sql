-- ════════════════════════════════════════════════════════════════════════════
-- שלב 7 — נדל"ן (§3.5) ופרייבט (§2.1): ההבטחות המבניות והזהות מול lib/rules.
-- רץ מ-verify-db.sh אחרי ההבטחות של ה-ADDENDUM.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  n int;
  profit numeric;
  targets numeric;
begin
  -- ── §3.5 — ה-views קיימים ─────────────────────────────────────────────────
  select count(*) into n from pg_views
  where viewname in ('v_realestate_profit', 'v_realestate_profit_year',
                     'v_partner_positions', 'v_investor_loan', 'v_cash_discount',
                     'v_private_income', 'v_private_income_summary');
  assert n = 7, format('שלב 7 — רק %s מ-7 ה-views קיימים', n);
  raise notice '✓ §3.5 + §2.1 — כל ה-views של שלב 7 קיימים';

  -- ── §2.1 — פרייבט לא נוגע בעולם העסקי ─────────────────────────────────────
  -- v_private_income לא מצטרף ל-transactions: אין לו בכלל עמודת tx.
  select count(*) into n from information_schema.columns
  where table_name = 'v_private_income' and column_name in ('tx_id', 'deal_id', 'division');
  assert n = 0, '§2.1 — v_private_income נוגע בעולם העסקי';
  raise notice '✓ §2.1 — הכנסות פרייבט מנותקות מ-transactions';

  -- ── §11.4 — אין מחיקה פיזית גם בטבלאות של שלב 7 ───────────────────────────
  insert into private_income (fund_name, amount_net, vat_amount)
  values ('בדיקה', 1000, 0);
  begin
    delete from private_income where fund_name = 'בדיקה';
    assert false, '§11.4 — DELETE פיזי ב-private_income לא נחסם';
  exception when others then null; end;
  raise notice '✓ §11.4 — private_income מוגנת מפני מחיקה פיזית';

  -- ── §3.5 — 33/33/33 על נתונים שהבדיקה מייצרת בעצמה (ונמחקים ב-rollback) ──
  -- בלי זה הבדיקה שותקת כשאין נתוני נדל"ן, וזה בדיוק המצב היום.
  declare
    acc uuid; cat uuid; a uuid;
  begin
    select id into acc from accounts where type = 'bank' limit 1;
    select id into cat from categories limit 1;

    insert into partners (name, division, share_pct, pay_method)
    values ('בדיקה א', 'realestate', 0.3333, 'invoice'),
           ('בדיקה ב', 'realestate', 0.3333, 'invoice'),
           ('בדיקה ג', 'realestate', 0.3334, 'payslip');
    -- רק שותפי הבדיקה, כדי שהבדיקה תהיה דטרמיניסטית.
    update partners set active = false where name not like 'בדיקה %';

    insert into transactions (date_cash, account_id, amount_net, vat_mode, nature, division, category_id, certainty, deductible, description)
    values ('2099-03-01', acc, 90000, 'exempt', 'income', 'realestate', cat, 'actual', null, 'עסקת בדיקה'),
           ('2099-03-05', acc, -30000, 'exempt', 'expense', 'realestate', cat, 'actual', true, 'הוצאת בדיקה'),
           -- לא מוכרת: §3.5 דורש deductible=1, ולכן היא לא אמורה להיכנס.
           ('2099-03-06', acc, -10000, 'exempt', 'expense', 'realestate', cat, 'actual', false, 'לא מוכרת');

    select id into a from partners where name = 'בדיקה א';
    insert into partner_draws (date, partner_id, amount, type)
    values ('2099-04-01', a, 25000, 'management_fee'),
           ('2099-04-02', a, 5000, 'owner_loan'),      -- חו"ז, לא משיכה
           ('2099-04-03', a, 2000, 'loan_repayment');  -- חו"ז, לא משיכה

    select y.profit into profit from v_realestate_profit_year y where y.year = '2099';
    assert abs(profit - 60000) < 0.01,
      format('§3.5 — רווח לחלוקה %s במקום 60000 (ההוצאה הלא-מוכרת נספרה?)', profit);

    select coalesce(sum(pp.target), 0) into targets from v_partner_positions pp where pp.year = '2099';
    assert abs(targets - profit) < 0.05,
      format('§3.5 — סכום היעדים %s ≠ הרווח לחלוקה %s', targets, profit);
    raise notice '✓ §3.5 — 33/33/33: סכום היעדים = הרווח לחלוקה, בלי לאבד אגורה';

    select pp.drawn into targets from v_partner_positions pp where pp.year = '2099' and pp.partner_id = a;
    assert abs(targets - 25000) < 0.01,
      format('§3.5 — נמשך %s: חו"ז נספר כמשיכה', targets);
    raise notice '✓ §3.5 — הלוואת בעלים והחזר אינם משיכה מול היעד';

    select count(*) into n from v_partner_positions pp
    where pp.year = '2099' and abs(pp.variance - (pp.drawn - pp.target)) > 0.01;
    assert n = 0, format('§3.5 — %s שורות שבהן הסטייה אינה נמשך פחות יעד', n);
    raise notice '✓ §3.5 — הסטייה היא נמשך פחות יעד, תמיד';
  end;

  -- ── §3.5 — חו"ז בעלים לא נספר כמשיכה ──────────────────────────────────────
  select count(*) into n from v_partner_positions pp
  where pp.owner_loan_balance <> pp.owner_loans - pp.loan_repayments;
  assert n = 0, '§3.5 — חו"ז הבעלים אינו הלוואות פחות החזרים';
  raise notice '✓ §3.5 — חו"ז בעלים = הלוואות פחות החזרים, בנפרד מהמשיכה';

  -- ── §2.1 — החלוקה בכל שורה מסתכמת לסכום עצמו ──────────────────────────────
  select count(*) into n from v_private_income pi
  where abs((pi.dan_amount + pi.nissim_amount) - pi.amount_net) > 0.02;
  assert n = 0, format('§2.1 — %s שורות שבהן דן+ניסים ≠ הסכום', n);
  raise notice '✓ §2.1 — דן + ניסים = הסכום, בכל שורה';
end;
$$;

rollback;

-- ── §3.5 — חוב המשקיע מוצג רק כשהוזנה יתרת פתיחה (שאלה #8) ─────────────────
do $$
declare n int;
begin
  select count(*) into n from v_investor_loan il where il.opening_balance <= 0;
  assert n = 0, '§3.5 — חוב משקיע מוצג בלי יתרת פתיחה שהוזנה';
  raise notice '✓ §3.5 — חוב משקיע מופיע רק אחרי שדן הזין יתרת פתיחה';
end;
$$;
