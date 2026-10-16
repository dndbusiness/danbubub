-- ════════════════════════════════════════════════════════════════════════════
-- קבצים במסד (017): קובץ שנשמר לא משתנה, אין מחיקה פיזית, והבייטים לא נכנסים
-- ליומן השינויים. הגדרות נרשמות ביומן. רץ מ-verify-db.sh. הכל ב-rollback.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  fid uuid;
  logged jsonb;
begin
  insert into stored_files (name, mime, bytes, sha256, kind)
  values ('הסכם.pdf', 'application/pdf', '\x255044462d'::bytea, repeat('c', 64), 'sign')
  returning id into fid;

  begin
    update stored_files set bytes = '\x00'::bytea where id = fid;
    assert false, 'קבצים — תוכן של קובץ שנשמר השתנה';
  exception when raise_exception then null; end;
  raise notice '✓ קבצים — קובץ שנשמר לא משתנה';

  begin
    delete from stored_files where id = fid;
    assert false, 'קבצים — מחיקה פיזית עברה';
  exception when restrict_violation then null; end;
  raise notice '✓ קבצים — אין מחיקה פיזית';

  select new_value into logged from audit_log where table_name = 'stored_files' and row_id = fid::text and action = 'INSERT';
  assert logged is not null, 'קבצים — לא נרשם ביומן';
  assert not (logged ? 'bytes'), 'קבצים — הבייטים נכנסו ליומן';
  raise notice '✓ קבצים — נרשם ביומן בלי הבייטים';

  insert into settings (key, value) values ('test_audit_key', '1'::jsonb);
  update settings set value = 'null'::jsonb where key = 'test_audit_key';
  assert exists (select 1 from audit_log where table_name = 'settings' and action = 'UPDATE' and new_value ->> 'key' = 'test_audit_key'), 'הגדרות — שינוי לא נרשם ביומן';
  begin
    delete from settings where key = 'test_audit_key';
    assert false, 'הגדרות — מחיקה פיזית עברה';
  exception when restrict_violation then null; end;
  raise notice '✓ הגדרות — כל שינוי ביומן, "מחיקה" = null';
end $$;

rollback;
