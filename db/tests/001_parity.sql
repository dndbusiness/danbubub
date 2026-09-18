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
  -- SPEC §8: יולי −28,262 · אוגוסט 105,882 · ספטמבר 22,447
  for r in select month, line4_distributable_profit as profit, line7_closing_balance as balance
           from v_nissim_card order by month
  loop
    expected := case r.month
      when '2026-07' then -28262
      when '2026-08' then 105882
      when '2026-09' then 22447
    end;
    assert r.profit = expected,
      format('%s: רווח לחלוקה %s ≠ יעד %s', r.month, r.profit, expected);
    raise notice '✓ % רווח לחלוקה = %', r.month, r.profit;
  end loop;

  -- SPEC §8: יתרת ניסים 36,517
  select line7_closing_balance into expected
  from v_nissim_card where month = '2026-09';
  assert expected = 36517, format('יתרת ספטמבר %s ≠ 36,517', expected);
  raise notice '✓ יתרת ניסים סוף ספטמבר = %', expected;

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
    select abs(sum(t.amount_net)) into shared_total
    from transactions t where t.division = 'shared' and t.deleted_at is null;

    select abs(sum(a.amount_net)) into allocated_total
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

  -- SPEC §3.4 — התקבול השני נספר בספטמבר ולא ביולי
  declare sep_from_july numeric;
  begin
    select sum(c.amount_net) into sep_from_july
    from v_tx_classified c
    join deals d on d.id = c.deal_id
    where c.month_cash = '2026-09' and c.nature = 'income'
      and d.month_attributed = '2026-07';
    assert sep_from_july = 38000,
      format('§3.4 תקבול שני: % ≠ 38,000', sep_from_july);
    raise notice '✓ §3.4 תקבול שני נספר בחודש שנכנס (ליקוי #3)';
  end;

  raise notice '';
  raise notice 'ה-views וה-/lib/rules מחזירים את אותם מספרים.';
end;
$$;
