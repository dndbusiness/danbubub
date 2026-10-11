-- ════════════════════════════════════════════════════════════════════════════
-- חתימה דיגיטלית (016): הסכם חתום נעול, נוסח שנשלח קפוא, אין מחיקה פיזית,
-- וחתום ⇔ יש חותם + ת"ז + חתימה + מועד. רץ מ-verify-db.sh. הכל ב-rollback.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  rid uuid;
  sig text := 'data:image/png;base64,' || repeat('A', 2000);
begin
  insert into sign_requests (token_hash, client_doc, client_name, division, title, body_html, doc_hash, expires_at)
  values (repeat('a', 64), 'c1', 'בדיקה', 'finance', 'הסכם', '<p>נוסח</p>', repeat('b', 64), now() + interval '14 days')
  returning id into rid;

  -- נוסח שנשלח לא משתנה גם לפני חתימה
  begin
    update sign_requests set body_html = '<p>אחר</p>' where id = rid;
    assert false, 'חתימה — נוסח שנשלח השתנה';
  exception when raise_exception then null; end;
  raise notice '✓ חתימה — נוסח שנשלח קפוא';

  -- "חתום" בלי חתימה — נדחה
  begin
    update sign_requests set status = 'signed', signed_at = now() where id = rid;
    assert false, 'חתימה — סומן חתום בלי חותם/חתימה';
  exception when check_violation then null; end;
  raise notice '✓ חתימה — חתום ⇔ יש חותם, ת"ז, חתימה ומועד';

  update sign_requests set status = 'signed', signed_at = now(), signer_name = 'דנה', signer_id_number = '123456782', signature_png = sig where id = rid;

  -- אחרי חתימה: החותם / החתימה / הסטטוס לא משתנים
  begin
    update sign_requests set signer_name = 'מישהו אחר' where id = rid;
    assert false, 'חתימה — הסכם חתום השתנה';
  exception when raise_exception then null; end;
  begin
    update sign_requests set status = 'cancelled' where id = rid;
    assert false, 'חתימה — הסכם חתום בוטל';
  exception when raise_exception then null; end;
  raise notice '✓ חתימה — הסכם חתום נעול';

  -- מותר: תוצרי PDF / דרייב
  update sign_requests set drive_file_id = 'x', drive_url = 'https://drive.google.com/x', finalize_error = null where id = rid;
  raise notice '✓ חתימה — אחרי חתימה מותר לעדכן רק את ה-PDF והדרייב';

  -- §11.4 — אין מחיקה פיזית
  begin
    delete from sign_requests where id = rid;
    assert false, '§11.4 — DELETE פיזי ב-sign_requests לא נחסם';
  exception when others then null; end;
  raise notice '✓ §11.4 — sign_requests מוגנת מפני מחיקה פיזית';

  -- ת"ז רק 9 ספרות
  begin
    insert into sign_requests (token_hash, client_doc, client_name, division, title, body_html, doc_hash, expires_at, status, signed_at, signer_name, signer_id_number, signature_png)
    values (repeat('c', 64), 'c1', 'x', 'finance', 't', '<p>x</p>', repeat('d', 64), now(), 'signed', now(), 'x', '12AB', sig);
    assert false, 'חתימה — ת"ז לא תקינה נשמרה';
  exception when check_violation then null; end;
  raise notice '✓ חתימה — ת"ז נשמרת כ-9 ספרות בלבד';
end $$;

rollback;
