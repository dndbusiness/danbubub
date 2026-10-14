-- ════════════════════════════════════════════════════════════════════════════
-- 019 — טפסים מ-PDF (מפרט "מערכת טפסים" של WISE).
--
-- sign_templates — תבנית PDF קבועה: הקובץ (stored_files) + השדות שהוצבו עליו (חתימה, שם,
-- ת"ז, תאריך, טקסט, סימון — לכל לווה). מסודרת לפי סוג וגוף (בנק / ביטוח / קרן…),
-- "מערכת" (לכל המשרד) או "אישית".
--
-- מעטפה מ-PDF (sign_envelopes.source_file_id) — המסמך המקורי + צילום השדות ברגע השליחה.
-- מרגע השליחה לא משתנים (כמו הנוסח המוקלד ב-016). PDF חתום = המקור + החתימות עליו
-- + עמוד תיעוד, נשמר כקובץ חדש.
--
-- נמען: לקוח או מתעניין (ליד) — recipient_kind.
-- ════════════════════════════════════════════════════════════════════════════

create table sign_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 200),
  category     text not null default 'bank' check (category in ('agreement', 'bank', 'fund', 'insurance', 'poa', 'general')),
  -- הגוף (בנק לאומי, הפניקס, מימון ישיר…) — התיקייה בספרייה
  folder       text,
  scope        text not null default 'system' check (scope in ('system', 'personal')),
  -- משתמש ה-CRM שהתבנית האישית שלו
  owner_key    text,
  division     text check (division is null or division in ('finance', 'realestate')),
  file_id      uuid not null references stored_files(id),
  page_sizes   jsonb not null check (jsonb_typeof(page_sizes) = 'array' and jsonb_array_length(page_sizes) between 1 and 60),
  fields       jsonb not null check (jsonb_typeof(fields) = 'array'),
  signers      int not null check (signers between 1 and 6),
  require_otp  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz,
  constraint sign_tpl_personal_owner check (scope = 'system' or owner_key is not null)
);
create index sign_templates_lib_idx on sign_templates (category, folder, name) where deleted_at is null;
select install_standard_triggers('sign_templates');

alter table sign_envelopes
  add column source_file_id uuid references stored_files(id),
  add column pdf_fields     jsonb check (pdf_fields is null or jsonb_typeof(pdf_fields) = 'array'),
  add column page_sizes     jsonb check (page_sizes is null or jsonb_typeof(page_sizes) = 'array'),
  add column template_id    uuid references sign_templates(id),
  add column recipient_kind text not null default 'client' check (recipient_kind in ('client', 'lead')),
  add constraint sign_env_pdf_complete check ((source_file_id is null) = (pdf_fields is null) and (source_file_id is null) = (page_sizes is null));

-- המסמך והשדות קפואים מרגע השליחה
create or replace function sign_envelopes_pdf_lock() returns trigger
language plpgsql as $$
begin
  if new.source_file_id is distinct from old.source_file_id or new.pdf_fields is distinct from old.pdf_fields
     or new.page_sizes is distinct from old.page_sizes or new.recipient_kind is distinct from old.recipient_kind then
    raise exception 'מסמך שנשלח לחתימה לא משתנה — בטל ושלח חדש (%).', old.id;
  end if;
  return new;
end;
$$;
create trigger t_sign_envelopes_pdf_lock before update on sign_envelopes for each row execute function sign_envelopes_pdf_lock();

-- מה שהחותם מילא בשדות הטקסט / הסימון — נעול אחרי החתימה כמו שאר פרטי החתימה
alter table sign_requests
  add column field_values jsonb not null default '{}'::jsonb check (jsonb_typeof(field_values) = 'object');

create or replace function sign_requests_values_lock() returns trigger
language plpgsql as $$
begin
  if old.status = 'signed' and new.field_values is distinct from old.field_values then
    raise exception 'הסכם חתום נעול — אי אפשר לשנות אותו (%).', old.id;
  end if;
  return new;
end;
$$;
create trigger t_sign_requests_values_lock before update on sign_requests for each row execute function sign_requests_values_lock();

comment on table sign_templates is 'תבנית PDF לחתימה: קובץ + שדות לכל לווה, לפי סוג וגוף. מערכת / אישית.';
