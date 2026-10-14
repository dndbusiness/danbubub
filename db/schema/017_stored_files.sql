-- ════════════════════════════════════════════════════════════════════════════
-- 017 — קבצים שנשמרים במסד, ויומן שינויים להגדרות ולשיעורי המע"מ.
--
-- למה: בשרת מנוהל (Vercel) הדיסק זמני ושונה בין בקשה לבקשה. PDF שנוצר בבקשה אחת
-- (הסכם חתום, דוח שבועי, דוח שכר) והמייל שמצרף אותו נשלח מבקשה אחרת — הקובץ כבר
-- לא שם. לכן כל קובץ שצריך לשרוד את הבקשה נשמר כאן, וה-outbox מצרף לפי מזהה.
--
-- הקובץ עצמו לא משתנה אחרי שנשמר (טריגר), ומחיקה רכה בלבד. היומן (audit_log) רושם
-- את כל השדות חוץ מהבייטים — אחרת כל PDF היה נשמר פעמיים.
-- ════════════════════════════════════════════════════════════════════════════

create table stored_files (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 300),
  mime        text not null check (length(mime) between 3 and 120),
  bytes       bytea not null check (octet_length(bytes) between 1 and 26214400),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- מה יצר את הקובץ (sign / report / intake …) — לסינון ולניקוי עתידי
  kind        text not null default 'file',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references users(id) default current_actor(),
  deleted_at  timestamptz
);
create index stored_files_sha_idx on stored_files (sha256) where deleted_at is null;

create trigger t_touch_stored_files before update on stored_files for each row execute function touch_updated_at();
create trigger t_nodelete_stored_files before delete on stored_files for each row execute function block_hard_delete();

create or replace function stored_files_immutable() returns trigger
language plpgsql as $$
begin
  if new.bytes is distinct from old.bytes or new.sha256 is distinct from old.sha256 then
    raise exception 'קובץ שנשמר לא משתנה — שומרים קובץ חדש (%).', old.id;
  end if;
  return new;
end;
$$;
create trigger t_stored_files_immutable before update on stored_files for each row execute function stored_files_immutable();

create or replace function audit_stored_files() returns trigger
language plpgsql security definer as $$
begin
  insert into audit_log (table_name, row_id, action, old_value, new_value, changed_by)
  values (tg_table_name, coalesce(new.id, old.id)::text, tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'bytes' end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'bytes' end,
    current_actor());
  return coalesce(new, old);
end;
$$;
create trigger t_audit_stored_files after insert or update or delete on stored_files for each row execute function audit_stored_files();

comment on table stored_files is 'קבצים שצריכים לשרוד את הבקשה (PDF חתום, דוחות, קבצי קליטה). בלתי ניתנים לשינוי; מחיקה רכה.';

alter table inbox_candidates add column file_id uuid references stored_files(id);
alter table sign_requests add column pdf_file_id uuid references stored_files(id);

-- ── הנחיה 4: יומן שינויים גם להגדרות (קודי PIN, crm_mode, יעדי מסירה) ולשיעורי המע"מ ──
-- "מחיקה" של הגדרה = ערך null (JSON), לא DELETE.
select install_standard_triggers('settings');
alter table vat_rates add column updated_at timestamptz not null default now();
select install_standard_triggers('vat_rates');
