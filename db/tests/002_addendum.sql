-- ════════════════════════════════════════════════════════════════════════════
-- ההבטחות המבניות של ה-ADDENDUM
--
-- כמו 000_guarantees.sql: מנסים להפר כל כלל ונכשלים אם ההפרה מצליחה.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;
set local app.current_user_id = '00000000-0000-4000-8000-000000000001';

do $$
declare
  ok boolean;
  actor uuid := (select id from users limit 1);
  a_deal uuid := (select id from deals limit 1);
  cat uuid := (select id from categories limit 1);
begin
  perform set_config('app.current_user_id', actor::text, true);

  -- ── הנחיה 17: חילוץ לא הופך ל-verified בלי אישור אנושי ─────────────────
  ok := true;
  begin
    insert into inbox_candidates (source, source_ref, received_at, verified)
    values ('gmail', 'msg-1', now(), true);
    ok := false;
  exception when check_violation then null; end;
  assert ok, 'הנחיה 17 — verified בלי אישור אנושי לא נחסם';

  insert into inbox_candidates (source, source_ref, received_at, verified, verified_by, verified_at)
  values ('gmail', 'msg-1', now(), true, actor, now());
  raise notice '✓ הנחיה 17 — verified דורש מי ומתי';

  -- ── ב.3 / §11.9: סריקה חוזרת לא מייצרת כפילות ──────────────────────────
  ok := true;
  begin
    insert into inbox_candidates (source, source_ref, received_at)
    values ('gmail', 'msg-1', now());
    ok := false;
  exception when unique_violation then null; end;
  assert ok, 'ב.3 — קליטה כפולה של אותה הודעה לא נחסמה';
  raise notice '✓ ב.3 סריקת מייל idempotent';

  -- ── הנחיה 18: התראה פעילה אחת לכל rule_key ─────────────────────────────
  insert into alerts (kind, rule_key, severity, title)
  values ('anchor_stale', 'anchor_stale:2026-09-18', 'high', 'העוגן לא עודכן');
  ok := true;
  begin
    insert into alerts (kind, rule_key, severity, title)
    values ('anchor_stale', 'anchor_stale:2026-09-18', 'high', 'שוב');
    ok := false;
  exception when unique_violation then null; end;
  assert ok, 'הנחיה 18 — התראה כפולה לא נחסמה';
  raise notice '✓ הנחיה 18 — התראה פעילה אחת לכל בעיה';

  -- אחרי סגירה, אותה בעיה יכולה לחזור
  update alerts set resolved_at = now() where rule_key = 'anchor_stale:2026-09-18';
  insert into alerts (kind, rule_key, severity, title)
  values ('anchor_stale', 'anchor_stale:2026-09-18', 'high', 'חזרה');
  raise notice '✓ הנחיה 18 — התראה שנסגרה יכולה להיווצר שוב';

  -- ── הנחיה 16: outbox מונע שליחה כפולה ──────────────────────────────────
  insert into outbox (channel, target, subject, dedup_key)
  values ('email', 'dan@harel.co.il', 'סיכום יומי', 'daily_summary:2026-09-18');
  ok := true;
  begin
    insert into outbox (channel, target, subject, dedup_key)
    values ('email', 'dan@harel.co.il', 'סיכום יומי', 'daily_summary:2026-09-18');
    ok := false;
  exception when unique_violation then null; end;
  assert ok, 'הנחיה 16 — שליחה כפולה לא נחסמה';
  raise notice '✓ הנחיה 16 — outbox מונע שליחה כפולה';

  -- ── ב.5: פריט חסום חייב סיבה ───────────────────────────────────────────
  ok := true;
  begin
    insert into deal_checklist_items (deal_id, sort_order, label, status)
    values (a_deal, 1, 'מסמכי לקוח', 'blocked');
    ok := false;
  exception when check_violation then null; end;
  assert ok, 'ב.5 — פריט חסום בלי סיבה לא נחסם';

  insert into deal_checklist_items (deal_id, sort_order, label, status, blocked_reason)
  values (a_deal, 1, 'מסמכי לקוח', 'blocked', 'הלקוח לא שלח');
  raise notice '✓ ב.5 — פריט חסום חייב סיבה';

  -- ── ב.5: אין שני פריטים באותו מיקום בתיק ───────────────────────────────
  ok := true;
  begin
    insert into deal_checklist_items (deal_id, sort_order, label)
    values (a_deal, 1, 'כפילות');
    ok := false;
  exception when unique_violation then null; end;
  assert ok, 'ב.5 — פריט כפול באותו מיקום לא נחסם';
  raise notice '✓ ב.5 — סדר הפריטים בתיק ייחודי';

  -- ── §3.7.3: תצלום תחזית אחד לכל (חודש, אופק, פעילות, תרחיש) ────────────
  insert into forecast_snapshots
    (target_month, forecasted_at, horizon_days, division, scenario,
     predicted_collections, predicted_profit)
  values ('2026-12', '2026-11-01', 30, 'finance', 'base', 90000, 20000);
  ok := true;
  begin
    insert into forecast_snapshots
      (target_month, forecasted_at, horizon_days, division, scenario,
       predicted_collections, predicted_profit)
    values ('2026-12', '2026-11-02', 30, 'finance', 'base', 95000, 22000);
    ok := false;
  exception when unique_violation then null; end;
  assert ok, '§3.7.3 — תצלום תחזית כפול לא נחסם';
  raise notice '✓ §3.7.3 — תצלום אחד לכל אופק, פעילות ותרחיש';

  -- אופק לא חוקי
  ok := true;
  begin
    insert into forecast_snapshots
      (target_month, forecasted_at, horizon_days, division, scenario,
       predicted_collections, predicted_profit)
    values ('2026-12', '2026-11-01', 45, 'finance', 'base', 90000, 20000);
    ok := false;
  exception when check_violation then null; end;
  assert ok, '§3.7.3 — אופק לא חוקי לא נחסם';
  raise notice '✓ §3.7.3 — אופק מוגבל ל-30/60/90';

  -- ── ב.9: תקציב אחד לכל קטגוריה × פעילות × חודש ─────────────────────────
  insert into budgets (category_id, division, period, amount_net)
  values (cat, 'finance', '2026-10', 5000);
  ok := true;
  begin
    insert into budgets (category_id, division, period, amount_net)
    values (cat, 'finance', '2026-10', 7000);
    ok := false;
  exception when unique_violation then null; end;
  assert ok, 'ב.9 — תקציב כפול לא נחסם';
  raise notice '✓ ב.9 — תקציב אחד לכל קטגוריה, פעילות וחודש';

  -- ── ב.1: אין סודות בטבלת האינטגרציות ───────────────────────────────────
  declare secret_cols int;
  begin
    select count(*) into secret_cols
    from information_schema.columns
    where table_name = 'integrations'
      and (column_name ilike '%password%'
        or column_name ilike '%token%' and column_name <> 'vault_secret_id'
        or column_name ilike '%secret%' and column_name <> 'vault_secret_id');
    assert secret_cols = 0,
      format('הנחיה 15 — %s עמודות שעלולות להחזיק סוד', secret_cols);
    raise notice '✓ הנחיה 15 — אין עמודת סוד ב-integrations';
  end;

  -- ── §1.7: הטבלאות החדשות גם הן ביומן השינויים ──────────────────────────
  declare audited int;
  begin
    select count(distinct table_name) into audited
    from audit_log
    where table_name in ('alerts', 'outbox', 'deal_checklist_items',
                         'inbox_candidates', 'budgets', 'forecast_snapshots');
    assert audited = 6, format('§1.7 — רק %s מ-6 הטבלאות החדשות ביומן', audited);
    raise notice '✓ §1.7 — הטבלאות החדשות נכנסות ליומן השינויים';
  end;

  raise notice '';
  raise notice 'הבטחות ה-ADDENDUM נאכפות.';
end;
$$;

rollback;

-- ── ב.6 — v_collection_flags מול lib/rules/collections.ts (אותם ספים) ──────
do $$
declare n int;
begin
  -- הספים: 7 ימים לתקבול ללא חשבונית, 30 יום לחשבונית שלא שולמה.
  select count(*) into n from pg_views where viewname = 'v_collection_flags';
  assert n = 1, 'ב.6 — v_collection_flags חסר';
  select count(*) into n from pg_views where viewname = 'v_collections_ops';
  assert n = 1, 'ב.6 — v_collections_ops חסר';
  select count(*) into n from pg_views where viewname = 'v_deal_document_status';
  assert n = 1, 'ב.6 — v_deal_document_status חסר';
  raise notice '✓ ב.6 — views הגביה קיימים (גיול, מסמך, דגלים)';
end;
$$;

-- ── §4.3 + §3.1 — views שלב 6: פערים 12 חודשים ותקופות מע"מ ────────────────
do $$
declare n int; m int;
begin
  select count(*) into n from pg_views where viewname = 'v_invoice_gaps_by_month';
  assert n = 1, '§4.3 — v_invoice_gaps_by_month חסר';
  select count(*) into n from pg_views where viewname = 'v_vat_periods';
  assert n = 1, '§3.1 — v_vat_periods חסר';

  -- 12 חודשים בדיוק, גם כשאין נתונים בכלל (השורות הריקות הן חלק מהדוח).
  select count(*) into m from v_invoice_gaps_by_month;
  assert m = 12, format('§4.3 — דוח הפערים מחזיר %s חודשים במקום 12', m);
  raise notice '✓ §4.3 — דוח הפערים תמיד 12 חודשים';

  -- §3.1 — חודש בלי תשומות מוכרות הוא חבות מלאה, לא NULL (זהות מול lib/rules/vat.ts).
  select count(*) into n from v_vat where liability is null or output_vat is null or input_vat_claimable is null;
  assert n = 0, format('§3.1 — %s תקופות מע"מ עם NULL במקום 0', n);
  raise notice '✓ §3.1 — אין NULL בחבות המע"מ';

  -- הפער נספר פעם אחת: אין gap_kind שלא מוכר לדוח.
  select count(*) into n from v_invoice_gaps
  where gap_kind not in ('income_without_invoice', 'invoice_without_receipt', 'expense_without_invoice');
  assert n = 0, format('§4.3 — %s שורות עם gap_kind לא מוכר', n);
  raise notice '✓ §4.3 — שלוש הבדיקות בלבד';
end;
$$;

-- ── §4.2 — דף בנק: שידוך ויתרה נשמרים בשורת הייבוא ────────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
  where table_name = 'import_rows' and column_name in ('matched_tx_id', 'match_status', 'balance', 'match_candidates');
  assert n = 4, format('§4.2 — חסרות עמודות שידוך ב-import_rows (%s מתוך 4)', n);

  select count(*) into n from information_schema.columns
  where table_name = 'invoices' and column_name in ('needs_partner_review', 'partner_id');
  assert n = 2, format('§4.3 — חסרות עמודות הכרעת שותף ב-invoices (%s מתוך 2)', n);
  raise notice '✓ §4.2 + §4.3 — עמודות השידוך והכרעת השותף קיימות';
end;
$$;
