-- ════════════════════════════════════════════════════════════════════════════
-- זהות בין ה-views לפונקציות הטהורות
--
-- נוסחאות §3 קיימות פעמיים: כפונקציות ב-/lib/rules (עם בדיקות vitest)
-- וכ-views ב-SQL. אם השתיים מתפצלות, שני מסכים יציגו שני מספרים שונים
-- לאותה שאלה. הבדיקה הזו מוודאת שה-views מחזירים את אותם יעדים מ-SPEC §8.
--
-- מריצים אחרי טעינת ה-seed שנוצר מאותו פיקסצ'ר (scripts/verify-db.sh).
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  r record;
  expected numeric;
begin
  -- SPEC §8 על הקובץ האמיתי: יולי −28,262 · אוגוסט 105,882 (זהים לקובץ).
  -- ספטמבר: הקובץ מציג 22,447 אבל השמיט 17,460 תקבולים ללא חודש (ליקוי #2)
  -- ו-1,585 הוצאות ישירות שלהם; המערכת סופרת אותם → 38,322. ההפרש 15,875
  -- הוא הכרעה עסקית של דן וניסים, לא באג.
  for r in select month, line4_distributable_profit as profit, line7_closing_balance as balance
           from v_nissim_card order by month
  loop
    expected := case r.month
      when '2026-07' then -28262
      when '2026-08' then 105882
      when '2026-09' then 22447 + 17460 - 1585
    end;
    assert r.profit = expected,
      format('%s: רווח לחלוקה %s ≠ יעד %s', r.month, r.profit, expected);
    raise notice '✓ % רווח לחלוקה = %', r.month, r.profit;
  end loop;

  -- יתרת ניסים: 36,516.5 בקובץ − מחצית ההפרש = 28,579
  select line7_closing_balance into expected
  from v_nissim_card where month = '2026-09';
  assert expected = 36516.5 - (17460 - 1585) / 2.0, format('יתרת ספטמבר %s ≠ 28,579', expected);
  raise notice '✓ יתרת ניסים סוף ספטמבר = % (קובץ: 36,516.5 לפני התקבולים שהושמטו)', expected;

  -- 3 התקבולים שהקובץ השמיט מסומנים לשאלה
  declare flagged numeric; n int;
  begin
    select count(*), coalesce(sum(amount_net), 0) into n, flagged
    from transactions where nature = 'income' and review_status = 'ask_nissim' and deleted_at is null;
    assert n = 3 and flagged = 17460, format('תקבולים ללא חודש: %s שורות, %s ₪', n, flagged);
    raise notice '✓ ליקוי #2: 3 תקבולים (17,460) שהקובץ השמיט — מסומנים "לשאול את ניסים"';
  end;

  -- v_pnl distributable חייב להתלכד עם שורה 4 בכרטיס
  for r in
    select c.month, c.line4_distributable_profit as card, p.profit as pnl
    from v_nissim_card c
    join v_pnl p on p.month = c.month and p.division = 'finance' and p.mode = 'distributable'
  loop
    assert r.card = r.pnl,
      format('%s: כרטיס ניסים %s ≠ v_pnl %s', r.month, r.card, r.pnl);
  end loop;
  raise notice '✓ v_pnl(distributable, finance) מתלכד עם שורה 4 בכרטיס ניסים';

  -- SPEC §1.2 — חלוקת shared לא מאבדת ולא מכפילה
  declare shared_total numeric; allocated_total numeric;
  begin
    select coalesce(abs(sum(t.amount_net)), 0) into shared_total
    from transactions t where t.division = 'shared' and t.deleted_at is null;

    select coalesce(abs(sum(a.amount_net)), 0) into allocated_total
    from v_tx_allocated a
    join transactions t on t.id = a.tx_id
    where t.division = 'shared';

    assert abs(shared_total - allocated_total) < 0.01,
      format('חלוקת shared: מקור %s ≠ מחולק %s', shared_total, allocated_total);
    raise notice '✓ §1.2 סכום חלקי shared = הסכום המקורי (%)', shared_total;
  end;

  -- SPEC §2.1 — private לא מופיע בשום דוח עסקי
  declare leak int;
  begin
    select count(*) into leak
    from v_tx_allocated a
    join transactions t on t.id = a.tx_id
    where t.division = 'private';
    assert leak = 0, format('§2.1 %s תנועות private דלפו לדוחות', leak);
    raise notice '✓ §2.1 private לא דולף לדוחות עסקיים';
  end;

  -- ליקוי #1: הוצאות ישירות יולי 4,862 הוקלדו ידנית — מיובאות כשורה מסומנת, הרווח תואם לקובץ
  declare gap numeric;
  begin
    -- בייבוא האמיתי source_ref='…:direct-gap'; בפיקסצ'ר מזהים לפי התיאור
    select coalesce(abs(sum(amount_net)), 0) into gap from transactions
    where (source_ref like '%direct-gap' or description like '%הוקלד ידנית%') and deleted_at is null;
    assert gap = 4862, format('פער ידני יולי %s ≠ 4,862', gap);
    raise notice '✓ ליקוי #1: 4,862 שהוקלדו ידנית בקובץ — שורה מסומנת, לא מספר נעלם';
  end;

  raise notice '';
  raise notice 'ה-views וה-/lib/rules מחזירים את אותם מספרים.';
end;
$$;
