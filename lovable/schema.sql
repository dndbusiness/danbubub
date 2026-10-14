-- ════════════════════════════════════════════════════════════════════════════
-- הר-אל CRM על Lovable Cloud (Supabase). אותו מודל מסמכים כמו בדף ב-Claude:
-- אוסף + מזהה → אובייקט JSON. הדף עצמו לא משתנה — מתאם (crm-lovable.js) מממש את claude.use.
--
-- גישה: רק מי שרשום ב-crm_members. מצטרפים דרך crm_invites (דן מזמין לפי מייל);
-- crm_whoami() יוצר את החברות בכניסה הראשונה. owner/admin = הכל; team = כמו בדף:
-- לא קורא כספים / הוצאות / שכר / פרייבט / קמפיינים / מאגר כוורת, וכותב רק לאוספי הצוות.
-- אין DELETE פיזי: מחיקה = deleted_at. כל שינוי נרשם ב-crm_docs_history.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.crm_invites (
  email text primary key check (email = lower(email)),
  role text not null default 'team' check (role in ('owner', 'admin', 'team')),
  name text,
  created_at timestamptz not null default now()
);
create table if not exists public.crm_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'team' check (role in ('owner', 'admin', 'team')),
  name text,
  created_at timestamptz not null default now()
);
create sequence if not exists public.crm_docs_seq;
create table if not exists public.crm_docs (
  coll text not null check (coll ~ '^[A-Za-z0-9_-]{1,64}$'),
  doc_id text not null check (length(doc_id) between 1 and 200 and position('/' in doc_id) = 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  seq bigint not null default nextval('public.crm_docs_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (coll, doc_id)
);
create index if not exists crm_docs_seq_idx on public.crm_docs (seq);
create table if not exists public.crm_docs_history (
  id bigserial primary key,
  coll text not null, doc_id text not null,
  old_data jsonb, new_data jsonb, op text not null,
  changed_by uuid, changed_at timestamptz not null default now()
);
alter table public.crm_invites enable row level security;
alter table public.crm_members enable row level security;
alter table public.crm_docs enable row level security;
alter table public.crm_docs_history enable row level security;

-- ── תפקיד של המשתמש המחובר (null = לא חבר) ──
create or replace function public.crm_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.crm_members where user_id = auth.uid()
$$;

-- אוספים שרק owner/admin קוראים, ואוספים שהצוות כותב (כמו כללי ה-db בדף)
create or replace function public.crm_admin_read(c text) returns boolean
language sql immutable as $$
  select c = any (array['transactions','planned','expenses','campaigns','runs','private','payroll','reTx','reExpenses','rePlanned','kaveretPool'])
$$;
create or replace function public.crm_team_write(c text) returns boolean
language sql immutable as $$
  select c = any (array['tasks','files','days','tickets','outbox','team','leads','intakes','approvals','attendance'])
$$;

-- קריאה: חברים בלבד, לפי תפקיד. אין מדיניות כתיבה ישירה — רק דרך crm_write.
drop policy if exists crm_docs_read on public.crm_docs;
create policy crm_docs_read on public.crm_docs for select to authenticated
  using (public.crm_role() in ('owner', 'admin') or (public.crm_role() = 'team' and not public.crm_admin_read(coll)));
drop policy if exists crm_members_self on public.crm_members;
create policy crm_members_self on public.crm_members for select to authenticated
  using (user_id = auth.uid() or public.crm_role() in ('owner', 'admin'));

-- ── כניסה: מי אני. בפעם הראשונה — הופך הזמנה לחברות ──
create or replace function public.crm_whoami() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); em text := lower(coalesce(auth.jwt() ->> 'email', '')); m public.crm_members;
begin
  if uid is null then return null; end if;
  select * into m from public.crm_members where user_id = uid;
  if not found then
    insert into public.crm_members (user_id, email, role, name)
      select uid, em, i.role, i.name from public.crm_invites i where i.email = em
      returning * into m;
    if not found then return jsonb_build_object('member', false, 'email', em); end if;
  end if;
  return jsonb_build_object('member', true, 'id', m.user_id, 'email', m.email, 'role', m.role, 'name', coalesce(m.name, split_part(m.email, '@', 1)));
end $$;

-- ── מיזוג כמו במסד של Claude: עדכון = מיזוג ברמה העליונה; {"__delete__":true} מוחק שדה (בכל עומק) ──
create or replace function public.crm_strip(j jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v jsonb; out jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(j) <> 'object' then return j; end if;
  for k, v in select * from jsonb_each(j) loop
    if jsonb_typeof(v) = 'object' and v ? '__delete__' and v -> '__delete__' = 'true'::jsonb then continue; end if;
    out := out || jsonb_build_object(k, case when jsonb_typeof(v) = 'object' then public.crm_strip(v) else v end);
  end loop;
  return out;
end $$;

create or replace function public.crm_write(p_path text, p_op text, p_data jsonb default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare r text := public.crm_role(); c text; d text; cur jsonb; nxt jsonb; k text; v jsonb; s bigint;
begin
  if r is null then raise exception 'not_granted' using errcode = '42501'; end if;
  if p_path !~ '^[A-Za-z0-9_-]{1,64}/[^/]{1,200}$' then raise exception 'invalid_argument: %', p_path; end if;
  c := split_part(p_path, '/', 1); d := substr(p_path, length(c) + 2);
  if r = 'team' and not public.crm_team_write(c) then raise exception 'not_granted' using errcode = '42501'; end if;
  select data into cur from public.crm_docs where coll = c and doc_id = d and deleted_at is null for update;
  if p_op = 'delete' then
    update public.crm_docs set deleted_at = now(), seq = nextval('public.crm_docs_seq'), updated_at = now(), updated_by = auth.uid()
      where coll = c and doc_id = d and deleted_at is null returning seq into s;
    if s is not null then insert into public.crm_docs_history (coll, doc_id, old_data, new_data, op, changed_by) values (c, d, cur, null, 'delete', auth.uid()); end if;
    return coalesce(s, 0);
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_argument: data must be an object'; end if;
  if p_op = 'update' then
    nxt := coalesce(cur, '{}'::jsonb);
    for k, v in select * from jsonb_each(p_data) loop
      if jsonb_typeof(v) = 'object' and v ? '__delete__' and v -> '__delete__' = 'true'::jsonb then nxt := nxt - k;
      else nxt := nxt || jsonb_build_object(k, case when jsonb_typeof(v) = 'object' then public.crm_strip(v) else v end); end if;
    end loop;
  elsif p_op = 'set' then nxt := public.crm_strip(p_data);
  else raise exception 'invalid_argument: op %', p_op; end if;
  insert into public.crm_docs (coll, doc_id, data, updated_by) values (c, d, nxt, auth.uid())
  on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null, seq = nextval('public.crm_docs_seq'), updated_at = now(), updated_by = auth.uid()
  returning seq into s;
  insert into public.crm_docs_history (coll, doc_id, old_data, new_data, op, changed_by) values (c, d, cur, nxt, p_op, auth.uid());
  return s;
end $$;

-- משיכת שינויים אחרי seq (כולל מחיקות, data = null). RLS של crm_docs חל — security invoker.
create or replace function public.crm_changes(p_after bigint, p_limit int default 2000) returns table (coll text, doc_id text, seq bigint, data jsonb)
language sql stable security invoker set search_path = public as $$
  select coll, doc_id, seq, case when deleted_at is null then data end
  from public.crm_docs where seq > p_after order by seq limit least(greatest(p_limit, 1), 5000)
$$;

revoke all on function public.crm_write(text, text, jsonb) from public, anon;
grant execute on function public.crm_write(text, text, jsonb) to authenticated;
revoke all on function public.crm_whoami() from public, anon;
grant execute on function public.crm_whoami() to authenticated;
revoke all on function public.crm_changes(bigint, int) from public, anon;
grant execute on function public.crm_changes(bigint, int) to authenticated;
-- ב-Supabase טבלאות ב-public פתוחות כברירת מחדל ל-anon/authenticated — סוגרים, ופותחים רק קריאה (ה-RLS מסנן)
revoke all on public.crm_docs, public.crm_members, public.crm_invites, public.crm_docs_history from anon, authenticated;
grant select on public.crm_docs to authenticated;
grant select on public.crm_members to authenticated;
