-- ════════════════════════════════════════════════════════════════════════════
-- טפסים מ-PDF (019): המסמך והשדות קפואים מרגע השליחה, ערכי החותם נעולים אחרי
-- החתימה, תבנית אישית חייבת בעלים, ומתעניין (ליד) כנמען. רץ מ-verify-db.sh. הכל ב-rollback.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  fid uuid; fid2 uuid; tid uuid; eid uuid; r1 uuid; k text;
  sig text := 'data:image/png;base64,' || repeat('A', 2000);
begin
  insert into stored_files (name, mime, bytes, sha256, kind) values ('טופס.pdf', 'application/pdf', '\x255044462d'::bytea, repeat('d', 64), 'sign') returning id into fid;
  insert into stored_files (name, mime, bytes, sha256, kind) values ('אחר.pdf', 'application/pdf', '\x255044462d'::bytea, repeat('e', 64), 'sign') returning id into fid2;

  begin
    insert into sign_templates (name, scope, file_id, page_sizes, fields, signers) values ('אישי בלי בעלים', 'personal', fid, '[[595,842]]', '[]', 1);
    assert false, 'טפסים — תבנית אישית בלי בעלים עברה';
  exception when check_violation then null; end;
  insert into sign_templates (name, folder, file_id, page_sizes, fields, signers) values ('הסכמה לנתוני אשראי', 'בנק לאומי', fid, '[[595,842]]', '[{"id":"a","kind":"signature"}]', 1) returning id into tid;
  raise notice '✓ טפסים — תבנית PDF בספרייה; אישית רק עם בעלים';

  begin
    insert into sign_envelopes (client_doc, client_name, division, title, source_file_id) values ('l1', 'מתעניין', 'finance', 'טופס', fid);
    assert false, 'טפסים — מסמך PDF בלי שדות עבר';
  exception when check_violation then null; end;

  insert into sign_envelopes (client_doc, client_name, division, title, category, source_file_id, pdf_fields, page_sizes, template_id, recipient_kind, template_key)
    values ('l1', 'מתעניין', 'finance', 'הסכמה לנתוני אשראי', 'bank', fid, '[{"id":"a"}]', '[[595,842]]', tid, 'lead', 'pdf:' || tid) returning id into eid;
  select recipient_kind into k from v_sign_overview where id = eid; assert k = 'lead', 'טפסים — מתעניין ב-view ' || coalesce(k, 'null');

  begin
    update sign_envelopes set source_file_id = fid2 where id = eid;
    assert false, 'טפסים — הוחלף המסמך אחרי שליחה';
  exception when raise_exception then null; end;
  begin
    update sign_envelopes set pdf_fields = '[{"id":"b"}]' where id = eid;
    assert false, 'טפסים — הוזזו שדות אחרי שליחה';
  exception when raise_exception then null; end;
  raise notice '✓ טפסים — המסמך והשדות קפואים מרגע השליחה';

  insert into sign_requests (envelope_id, token_hash, client_doc, client_name, division, title, body_html, doc_hash, expires_at, signer_label, signer_order)
    values (eid, repeat('7', 64), 'l1', 'מתעניין', 'finance', 'הסכמה', '<p>PDF</p>', repeat('b', 64), now() + interval '14 days', 'לווה 1', 1) returning id into r1;
  update sign_requests set status = 'signed', signed_at = now(), signer_name = 'א', signer_id_number = '123456782', signature_png = sig, field_values = '{"acc":"123"}' where id = r1;
  begin
    update sign_requests set field_values = '{"acc":"999"}' where id = r1;
    assert false, 'טפסים — שונה ערך שהחותם מילא אחרי החתימה';
  exception when raise_exception then null; end;
  raise notice '✓ טפסים — מה שהחותם מילא נעול אחרי החתימה';

  -- מחיקה רכה של מסמך מותרת (גם הושלם); המסמך החתום נשאר
  update sign_envelopes set deleted_at = now() where id = eid;
  assert not exists (select 1 from v_sign_overview where id = eid), 'טפסים — מסמך שנמחק עדיין ברשימה';
  raise notice '✓ טפסים — מחיקה = הסתרה (soft delete)';
end $$;

rollback;
