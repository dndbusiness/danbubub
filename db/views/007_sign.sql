-- ════════════════════════════════════════════════════════════════════════════
-- "מסמכים לחתימה" — שורה לכל מסמך שנשלח, עם מצב החותמים. המסך ב-CRM והכרטיס
-- של הלקוח קוראים מכאן (אין נוסחת מצב בקוד ה-UI).
--
-- מצב:  completed  — כל החותמים חתמו
--       cancelled  — בוטל
--       partial    — חלק חתמו
--       opened     — מישהו פתח, אף אחד עוד לא חתם
--       expired    — כל הקישורים הפתוחים פגו
--       sent       — נשלח, לא נפתח
-- ════════════════════════════════════════════════════════════════════════════

create or replace view v_sign_overview as
with s as (
  select r.envelope_id,
         count(*) filter (where r.status <> 'cancelled')                                         as signers,
         count(*) filter (where r.status = 'signed')                                             as signed,
         count(*) filter (where r.status in ('sent', 'opened') and r.expires_at > now())          as waiting,
         count(*) filter (where r.status in ('sent', 'opened') and r.expires_at <= now())         as expired,
         count(*) filter (where r.opened_at is not null)                                         as opened,
         max(greatest(r.created_at, r.opened_at, r.signed_at, r.last_reminder_at))              as last_activity,
         min(r.expires_at) filter (where r.status in ('sent', 'opened'))                         as next_expiry,
         jsonb_agg(jsonb_build_object(
           'id', r.id, 'label', r.signer_label, 'order', r.signer_order, 'status', r.status,
           'expired', r.status in ('sent', 'opened') and r.expires_at <= now(),
           'email', r.send_email, 'phone', r.send_phone, 'signer', r.signer_name,
           'opened_at', r.opened_at, 'signed_at', r.signed_at, 'expires_at', r.expires_at,
           'require_otp', r.require_otp, 'otp_ok', r.otp_verified_at is not null,
           'reminders', r.reminders_sent, 'last_reminder_at', r.last_reminder_at
         ) order by r.signer_order, r.created_at)                                               as people
  from sign_requests r
  where r.deleted_at is null and r.envelope_id is not null
  group by r.envelope_id
)
select e.id, e.client_doc, e.client_name, e.division, e.title, e.category, e.template_key, e.lender,
       e.created_at, e.completed_at, e.drive_url, e.pdf_file_id, e.finalize_error,
       coalesce(s.signers, 0) as signers, coalesce(s.signed, 0) as signed, coalesce(s.waiting, 0) as waiting,
       coalesce(s.expired, 0) as expired, coalesce(s.opened, 0) as opened, s.last_activity, s.next_expiry,
       coalesce(s.people, '[]'::jsonb) as people,
       case
         when e.status = 'cancelled' then 'cancelled'
         when e.status = 'completed' then 'completed'
         when coalesce(s.signed, 0) > 0 then 'partial'
         when coalesce(s.waiting, 0) = 0 and coalesce(s.expired, 0) > 0 then 'expired'
         when coalesce(s.opened, 0) > 0 then 'opened'
         else 'sent'
       end as state
from sign_envelopes e
left join s on s.envelope_id = e.id
where e.deleted_at is null;

comment on view v_sign_overview is 'מסמכים לחתימה: מצב לכל מסמך וחותמים (completed/cancelled/partial/opened/expired/sent).';
