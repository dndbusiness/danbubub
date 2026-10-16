-- ════════════════════════════════════════════════════════════════════════════
-- 018 — מערכת חתימות: מסמך אחד, כמה חותמים, קוד אימות במייל, תזכורות.
--
-- "מעטפה" (sign_envelopes) = מסמך אחד שנשלח לחתימה. לכל חותם שורה ב-sign_requests
-- (016) עם קישור אישי משלו — הלווה, בן/בת הזוג, ערב. כשכל החותמים חתמו המעטפה
-- "הושלמה" ונוצר PDF אחד עם כל החתימות ועמוד תיעוד לכל חותם.
--
-- קוד אימות (OTP): כשנדרש, החותם מקבל קוד חד-פעמי במייל לפני החתימה. נשמר רק
-- ה-hash, תוקף 10 דקות, עד 5 ניסיונות. חתימה בלי אימות נדחית ב-DB (אילוץ).
--
-- תזכורת = קישור חדש (הטוקן מתחלף, הישן מפסיק לעבוד): הטוקן עצמו לא נשמר, רק ה-hash,
-- ולכן אי אפשר לשלוח שוב את אותו קישור.
-- ════════════════════════════════════════════════════════════════════════════

create table sign_envelopes (
  id              uuid primary key default gen_random_uuid(),
  client_doc      text not null check (length(client_doc) between 1 and 200),
  client_name     text not null,
  division        text not null check (division in ('finance', 'realestate')),
  title           text not null,
  -- סוג המסמך — ספריית התבניות מסודרת לפי סוג וגוף
  category        text not null default 'agreement'
                    check (category in ('agreement', 'bank', 'fund', 'insurance', 'poa', 'general')),
  template_key    text,
  lender          text,
  status          text not null default 'sent' check (status in ('sent', 'completed', 'cancelled')),
  completed_at    timestamptz,
  pdf_file_id     uuid references stored_files(id),
  drive_file_id   text,
  drive_url       text,
  finalize_error  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references users(id),
  deleted_at      timestamptz,
  constraint sign_envelope_completed check ((status = 'completed') = (completed_at is not null))
);
create index sign_envelopes_client_idx on sign_envelopes (client_doc, created_at desc) where deleted_at is null;
create index sign_envelopes_status_idx on sign_envelopes (status, created_at desc) where deleted_at is null;
select install_standard_triggers('sign_envelopes');

-- מעטפה שהושלמה לא חוזרת אחורה ולא מבוטלת
create or replace function sign_envelopes_lock() returns trigger
language plpgsql as $$
begin
  if old.status = 'completed' and (new.status is distinct from old.status or new.completed_at is distinct from old.completed_at
     or new.title is distinct from old.title or new.client_doc is distinct from old.client_doc) then
    raise exception 'מסמך שכל החותמים חתמו עליו נעול (%).', old.id;
  end if;
  return new;
end;
$$;
create trigger t_sign_envelopes_lock before update on sign_envelopes for each row execute function sign_envelopes_lock();

alter table sign_requests
  add column envelope_id      uuid references sign_envelopes(id),
  add column signer_label     text,
  add column signer_order     int not null default 1 check (signer_order between 1 and 20),
  add column require_otp      boolean not null default false,
  add column otp_hash         text check (otp_hash is null or otp_hash ~ '^[0-9a-f]{64}$'),
  add column otp_expires_at   timestamptz,
  add column otp_attempts     int not null default 0 check (otp_attempts >= 0),
  add column otp_sent_at      timestamptz,
  add column otp_verified_at  timestamptz,
  add column reminders_sent   int not null default 0 check (reminders_sent >= 0),
  add column last_reminder_at timestamptz,
  -- דרש קוד → חתום רק אחרי אימות
  add constraint sign_otp_before_sign check (not (require_otp and status = 'signed' and otp_verified_at is null));

create index sign_requests_envelope_idx on sign_requests (envelope_id, signer_order) where deleted_at is null;

-- הבקשות הקיימות (חותם יחיד) — כל אחת במעטפה משלה
do $$
declare r record; eid uuid;
begin
  for r in select * from sign_requests where envelope_id is null loop
    insert into sign_envelopes (client_doc, client_name, division, title, category, status, completed_at, drive_file_id, drive_url, finalize_error, created_at, deleted_at)
    values (r.client_doc, r.client_name, r.division, r.title, 'agreement',
            case when r.status = 'signed' then 'completed' when r.status = 'cancelled' then 'cancelled' else 'sent' end,
            case when r.status = 'signed' then r.signed_at end, r.drive_file_id, r.drive_url, r.finalize_error, r.created_at, r.deleted_at)
    returning id into eid;
    update sign_requests set envelope_id = eid, signer_label = 'הלקוח' where id = r.id;
  end loop;
end $$;

comment on table sign_envelopes is 'מסמך לחתימה: חותם אחד או יותר (sign_requests). הושלם = כל החותמים חתמו → PDF אחד עם כל החתימות.';
