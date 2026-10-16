-- ════════════════════════════════════════════════════════════════════════════
-- מערכת חתימות (018): קוד אימות לפני חתימה, מסמך שהושלם נעול, ומצבי v_sign_overview.
-- רץ מ-verify-db.sh. הכל ב-rollback.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  eid uuid; r1 uuid; r2 uuid; st text;
  sig text := 'data:image/png;base64,' || repeat('A', 2000);
begin
  insert into sign_envelopes (client_doc, client_name, division, title, category) values ('c9', 'בדיקה', 'finance', 'טופס בנק', 'bank') returning id into eid;
  insert into sign_requests (envelope_id, token_hash, client_doc, client_name, division, title, body_html, doc_hash, expires_at, signer_label, signer_order, require_otp)
    values (eid, repeat('1', 64), 'c9', 'לווה א', 'finance', 'טופס בנק', '<p>נוסח</p>', repeat('b', 64), now() + interval '14 days', 'לווה 1', 1, true) returning id into r1;
  insert into sign_requests (envelope_id, token_hash, client_doc, client_name, division, title, body_html, doc_hash, expires_at, signer_label, signer_order)
    values (eid, repeat('2', 64), 'c9', 'לווה ב', 'finance', 'טופס בנק', '<p>נוסח</p>', repeat('b', 64), now() + interval '14 days', 'לווה 2', 2) returning id into r2;

  select state into st from v_sign_overview where id = eid; assert st = 'sent', 'מסמכים — מצב התחלתי ' || st;
  update sign_requests set status = 'opened', opened_at = now() where id = r2;
  select state into st from v_sign_overview where id = eid; assert st = 'opened', 'מסמכים — אחרי פתיחה ' || st;

  -- דרש קוד → אי אפשר לחתום בלי אימות
  begin
    update sign_requests set status = 'signed', signed_at = now(), signer_name = 'א', signer_id_number = '123456782', signature_png = sig where id = r1;
    assert false, 'חתימות — חתימה בלי קוד אימות עברה';
  exception when check_violation then null; end;
  raise notice '✓ חתימות — בלי אימות הקוד אין חתימה';

  update sign_requests set otp_verified_at = now() where id = r1;
  update sign_requests set status = 'signed', signed_at = now(), signer_name = 'א', signer_id_number = '123456782', signature_png = sig where id = r1;
  select state into st from v_sign_overview where id = eid; assert st = 'partial', 'מסמכים — חלק חתמו ' || st;
  raise notice '✓ חתימות — מצבי המסמך: נשלח → נפתח → חלקי';

  update sign_requests set status = 'signed', signed_at = now(), signer_name = 'ב', signer_id_number = '000000018', signature_png = sig where id = r2;
  update sign_envelopes set status = 'completed', completed_at = now() where id = eid;
  select state into st from v_sign_overview where id = eid; assert st = 'completed', 'מסמכים — הושלם ' || st;
  begin
    update sign_envelopes set status = 'cancelled' where id = eid;
    assert false, 'חתימות — מסמך שהושלם בוטל';
  exception when raise_exception then null; end;
  raise notice '✓ חתימות — מסמך שכל החותמים חתמו עליו נעול';

  begin
    update sign_envelopes set status = 'completed', completed_at = null where id = eid;
    assert false, 'חתימות — הושלם בלי מועד';
  exception when check_violation or raise_exception then null; end;

  begin
    delete from sign_envelopes where id = eid;
    assert false, 'חתימות — מחיקה פיזית עברה';
  exception when restrict_violation then null; end;
  raise notice '✓ חתימות — אין מחיקה פיזית למסמכים';
end $$;

rollback;
