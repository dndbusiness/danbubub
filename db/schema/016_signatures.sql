-- ════════════════════════════════════════════════════════════════════════════
-- 016 — חתימה דיגיטלית על הסכם התקשרות.
--
-- דן שולח מכרטיס הלקוח קישור אישי (/s/<token>); הלקוח פותח בטלפון בלי להירשם,
-- קורא, ממלא שם ות"ז, חותם באצבע ומאשר. נוצר PDF עם עמוד תיעוד, נשמר בתיקיית
-- הלקוח בדרייב ("הסכמי התקשרות"), והכרטיס מתעדכן.
--
-- מה שנחתם הוא צילום הנוסח ברגע השליחה (body_html) + טביעה (doc_hash, SHA-256).
-- הטוקן עצמו לא נשמר — רק ה-hash שלו (token_hash); מי שיש לו גישה ל-DB לא יכול
-- לחתום בשם הלקוח.
--
-- אחרי חתימה השורה נעולה: הנוסח, הטביעה והחתימה לא משתנים יותר (טריגר). מותר
-- רק לעדכן את תוצרי ה-PDF / הדרייב ולבטל רכות (deleted_at).
-- ════════════════════════════════════════════════════════════════════════════

create table sign_requests (
  id                uuid primary key default gen_random_uuid(),
  token_hash        text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- הלקוח ב-CRM (crm_docs: clients/<client_doc>)
  client_doc        text not null check (length(client_doc) between 1 and 200),
  client_name       text not null,
  division          text not null check (division in ('finance', 'realestate')),
  title             text not null,
  -- צילום הנוסח שנשלח, אחרי מילוי השדות. זה מה שהלקוח רואה וחותם עליו.
  body_html         text not null,
  doc_hash          text not null check (doc_hash ~ '^[0-9a-f]{64}$'),
  fields            jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  send_email        text,
  send_phone        text,
  status            text not null default 'sent'
                      check (status in ('sent', 'opened', 'signed', 'cancelled')),
  expires_at        timestamptz not null,
  opened_at         timestamptz,
  signed_at         timestamptz,
  signer_name       text,
  signer_id_number  text check (signer_id_number is null or signer_id_number ~ '^[0-9]{9}$'),
  -- PNG של החתימה (data URL). מוגבל בגודל — חתימת אצבע היא עשרות KB.
  signature_png     text check (signature_png is null or (signature_png like 'data:image/png;base64,%' and length(signature_png) < 600000)),
  signer_ip         text,
  signer_ua         text,
  pdf_path          text,
  drive_file_id     text,
  drive_url         text,
  finalize_error    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references users(id),
  deleted_at        timestamptz,
  -- חתום ⇔ יש חותם, ת"ז, חתימה ומועד
  constraint sign_signed_complete check (
    (status = 'signed') = (signed_at is not null and signer_name is not null and signer_id_number is not null and signature_png is not null)
  )
);

create index sign_requests_client_idx on sign_requests (client_doc, created_at desc) where deleted_at is null;

select install_standard_triggers('sign_requests');

-- הסכם חתום לא משתנה: לא הנוסח, לא הטביעה, לא החותם ולא החתימה.
create or replace function sign_requests_lock() returns trigger
language plpgsql as $$
begin
  if old.status = 'signed' and (
       new.status is distinct from old.status
    or new.body_html is distinct from old.body_html
    or new.doc_hash is distinct from old.doc_hash
    or new.title is distinct from old.title
    or new.fields is distinct from old.fields
    or new.signed_at is distinct from old.signed_at
    or new.signer_name is distinct from old.signer_name
    or new.signer_id_number is distinct from old.signer_id_number
    or new.signature_png is distinct from old.signature_png
    or new.signer_ip is distinct from old.signer_ip
    or new.signer_ua is distinct from old.signer_ua
    or new.token_hash is distinct from old.token_hash
  ) then
    raise exception 'הסכם חתום נעול — אי אפשר לשנות אותו (%).', old.id;
  end if;
  -- לפני חתימה הנוסח קפוא מרגע השליחה
  if old.status <> 'signed' and (new.body_html is distinct from old.body_html or new.doc_hash is distinct from old.doc_hash) then
    raise exception 'נוסח שנשלח לחתימה לא משתנה — בטל ושלח חדש (%).', old.id;
  end if;
  return new;
end;
$$;

create trigger t_sign_requests_lock before update on sign_requests
  for each row execute function sign_requests_lock();

comment on table sign_requests is
  'חתימה דיגיטלית על הסכם התקשרות: קישור אישי, צילום נוסח + SHA-256, חתימת אצבע, PDF עם עמוד תיעוד לדרייב. חתום = נעול.';
