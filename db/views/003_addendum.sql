-- ════════════════════════════════════════════════════════════════════════════
-- Views — ADDENDUM: גביה, צ'קליסט ביצוע, בריאות המערכת
-- ADDENDUM ב.5, ב.6, חלק ג
-- ════════════════════════════════════════════════════════════════════════════

/*
 * v_collections_aging — ADDENDUM ב.6.
 * גיול היתרות הפתוחות, עם הפיצול לוודאי/פוטנציאלי.
 */
create or replace view v_collections as
select
  b.deal_id,
  b.client_name,
  b.division,
  b.collection_status,
  b.open_balance_net                                   as open_amount,
  b.open_committed,
  b.open_expected_weighted                             as open_expected,
  due.due_date,
  greatest(0, current_date - due.due_date)             as days_overdue,
  case
    when due.due_date is null then '0-30'
    when current_date - due.due_date <= 30 then '0-30'
    when current_date - due.due_date <= 60 then '31-60'
    when current_date - due.due_date <= 90 then '61-90'
    else '90+'
  end                                                  as aging_bucket,
  d.owner_user_id,
  d.stage,
  d.status
from v_deal_balance b
join deals d on d.id = b.deal_id
left join lateral (
  select min(p.expected_date) as due_date
  from deal_payments_plan p
  where p.deal_id = b.deal_id and p.matched_tx_id is null and p.deleted_at is null
) due on true
where b.open_balance_net > 0
  and d.status not in ('lost', 'cancelled')
  and d.deleted_at is null;

create or replace view v_collections_aging as
select
  division,
  aging_bucket,
  sum(open_amount)      as amount,
  sum(open_committed)   as committed,
  sum(open_expected)    as expected,
  count(*)              as deal_count
from v_collections
group by division, aging_bucket;

comment on view v_collections_aging is
  'ADDENDUM ב.6 — 4 קוביות הגיול במסך 20.';

/*
 * v_execution_pipeline — ADDENDUM ב.5.
 * "מה צריך כדי לבצע ולקבל כספים" — הפריט הבא שחסר לכל תיק.
 */
create or replace view v_execution_pipeline as
select
  c.deal_id,
  d.client_name,
  d.division,
  d.owner_user_id,
  b.open_balance_net                            as amount_at_stake,
  nxt.label                                     as next_missing,
  nxt.status                                    as next_status,
  nxt.blocked_reason,
  nxt.status_since,
  case when nxt.status_since is not null
       then current_date - nxt.status_since end as stuck_days,
  round(
    100.0 * count(*) filter (where c.status = 'done')
    / nullif(count(*) filter (where c.status <> 'n/a'), 0), 2
  )                                             as completion_pct
from deal_checklist_items c
join deals d on d.id = c.deal_id
join v_deal_balance b on b.deal_id = c.deal_id
left join lateral (
  -- הפריט הבא שחסר: הראשון בסדר שאינו done ואינו n/a.
  select i.label, i.status, i.blocked_reason, i.status_since
  from deal_checklist_items i
  where i.deal_id = c.deal_id
    and i.status not in ('done', 'n/a')
    and i.deleted_at is null
  order by i.sort_order
  limit 1
) nxt on true
where c.deleted_at is null
  and d.deleted_at is null
  and nxt.label is not null          -- תיק שהושלם אינו ברשימה
group by c.deal_id, d.client_name, d.division, d.owner_user_id,
         b.open_balance_net, nxt.label, nxt.status, nxt.blocked_reason, nxt.status_since;

comment on view v_execution_pipeline is
  'ADDENDUM ב.5 — עונה על "מה צריך כדי לבצע ולקבל כספים", ברמת תיק.';

/* פילוח החברה לפי הפריט החוסם — "60% מהם מחכים למסמכי לקוח". */
create or replace view v_execution_blockers as
select
  next_missing                                   as blocker,
  count(*)                                       as deal_count,
  sum(amount_at_stake)                           as amount,
  round(100.0 * sum(amount_at_stake)
        / nullif(sum(sum(amount_at_stake)) over (), 0), 2) as pct_of_total
from v_execution_pipeline
group by next_missing;

/*
 * v_system_health — ADDENDUM חלק ג.
 * "מסך בריאות המערכת בהגדרות מציג את 7 הימים האחרונים."
 */
create or replace view v_system_health as
select
  job_name,
  count(*)                                             as runs_7d,
  count(*) filter (where status = 'succeeded')         as succeeded,
  count(*) filter (where status = 'failed')            as failed,
  max(started_at)                                      as last_run_at,
  max(started_at) filter (where status = 'succeeded')  as last_success_at,
  (array_agg(error order by started_at desc)
     filter (where error is not null))[1]              as last_error
from scheduled_jobs_log
where started_at > now() - interval '7 days'
group by job_name;

/* התראות פעילות, ללא המושהות — מזין את קוביית "דורש טיפול" (ב.8). */
create or replace view v_active_alerts as
select *
from alerts
where resolved_at is null
  and deleted_at is null
  and (snoozed_until is null or snoozed_until <= current_date);

/* ADDENDUM ב.11 — "יותר מ-5 קריטיות → תזרים במצב סיכון". */
create or replace view v_risk_mode as
select
  count(*) filter (where severity = 'critical') as critical_count,
  count(*) filter (where severity = 'critical')
    > coalesce((select (value #>> '{}')::int from settings
                where key = 'risk_mode_critical_count'), 5) as is_risk_mode
from v_active_alerts;
