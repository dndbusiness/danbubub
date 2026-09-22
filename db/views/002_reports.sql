-- ════════════════════════════════════════════════════════════════════════════
-- Views — דוחות: רווח והפסד, כרטיס ניסים, מע"מ, תזרים, המרה
-- SPEC §3.1–§3.8 · §8 ("views: v_pnl, v_nissim_card, v_cashflow_13w, v_vat, v_conversion")
-- ════════════════════════════════════════════════════════════════════════════

-- ── v_pnl — רווח והפסד, שתי הגדרות (SPEC §3.2) ─────────────────────────────

/*
 * רווח *תפעולי*: כל ההכנסות וההוצאות בפועל, לפי חודש התנועה.
 * כולל הוצאות לא מוכרות ולא מאושרות — זה מה שבאמת יצא מהקופה.
 */
create or replace view v_pnl_operational as
select
  c.division,
  c.month_cash                                            as month,
  sum(c.amount_net) filter (where c.nature = 'income')    as income,
  abs(sum(c.amount_net) filter (where c.nature = 'expense')) as expenses,
  abs(sum(c.amount_net) filter (
    where c.nature = 'expense' and c.fixed_expense_id is not null
  ))                                                      as fixed_expenses,
  abs(sum(c.amount_net) filter (
    where c.nature = 'expense' and c.deal_id is not null
  ))                                                      as direct_expenses,
  sum(c.amount_net) filter (where c.nature in ('income', 'expense')) as profit
from v_tx_classified c
where c.certainty = 'actual'
  and c.nature in ('income', 'expense')   -- SPEC §1.3
group by c.division, c.month_cash;

/*
 * רווח *לחלוקה*: הסכם השותפות.
 *   • הכנסות — רק עם deal_id, בחודש שבו התקבול נכנס (§3.4).
 *   • הוצאות קבועות — רק deductible, ובמימון גם approved_by_nissim (§3.2).
 *   • הוצאות ישירות — לפי חודש *התיק*, לא חודש התנועה.
 */
create or replace view v_pnl_distributable as
with income as (
  select c.division, c.month_cash as month, sum(c.amount_net) as income
  from v_tx_classified c
  where c.certainty = 'actual' and c.nature = 'income' and c.deal_id is not null
  group by c.division, c.month_cash
),
fixed_and_variable as (
  select
    c.division,
    c.month_cash as month,
    abs(sum(c.amount_net)) as amount,
    abs(sum(c.amount_net) filter (where c.fixed_expense_id is not null)) as fixed_only
  from v_tx_classified c
  left join fixed_expenses f on f.id = c.fixed_expense_id
  where c.certainty = 'actual'
    and c.nature = 'expense'
    and c.deal_id is null
    and c.deductible is true
    and (
      c.fixed_expense_id is null                        -- משתנה מוכרת
      or c.division = 'realestate'                      -- §3.5: אין דרישת אישור
      or f.approved_by_nissim is true                   -- §3.2: מימון דורש אישור
    )
  group by c.division, c.month_cash
),
direct as (
  select
    c.division,
    dm.month_attributed as month,
    abs(sum(c.amount_net)) as amount
  from v_tx_classified c
  join v_deal_month dm on dm.deal_id = c.deal_id
  where c.certainty = 'actual'
    and c.nature = 'expense'
    and c.deal_id is not null
    and c.deductible is true
    and dm.month_attributed is not null
  group by c.division, dm.month_attributed
)
select
  coalesce(i.division, fv.division, dr.division) as division,
  coalesce(i.month, fv.month, dr.month)          as month,
  coalesce(i.income, 0)                          as income,
  coalesce(fv.amount, 0)                         as fixed_expenses,
  coalesce(dr.amount, 0)                         as direct_expenses,
  coalesce(i.income, 0) - coalesce(fv.amount, 0) - coalesce(dr.amount, 0) as profit
from income i
full outer join fixed_and_variable fv on fv.division = i.division and fv.month = i.month
full outer join direct dr
  on dr.division = coalesce(i.division, fv.division)
 and dr.month    = coalesce(i.month, fv.month);

create or replace view v_pnl as
select 'operational' as mode, division, month, income,
       fixed_expenses, direct_expenses, expenses as total_expenses, profit
from v_pnl_operational
union all
select 'distributable', division, month, income,
       fixed_expenses, direct_expenses, fixed_expenses + direct_expenses, profit
from v_pnl_distributable;

comment on view v_pnl is
  'SPEC §3.2 — שתי הגדרות רווח, בכוונה. המסך מחליף ביניהן במתג ומכריז איזו מוצגת.';

-- ── v_nissim_card — 8 שורות סגירת החודש (SPEC §3.3) ────────────────────────

/*
 * שורות 1–6. היתרה המתגלגלת (7–8) מחושבת ב-v_nissim_card, שכן היא
 * תלויה בחודש הקודם ודורשת חלון.
 */
create or replace view v_nissim_card_lines as
with months as (
  select distinct month from (
    select month from v_pnl_distributable where division = 'finance'
    union select period as month from advances where deleted_at is null
  ) m
),
profit as (
  select month, income, fixed_expenses, direct_expenses, profit
  from v_pnl_distributable
  where division = 'finance'
),
adv as (
  select period as month, sum(amount_gross) as advances
  from advances where deleted_at is null
  group by period
),
nissim_pct as (
  select coalesce((value #>> '{}')::numeric, 0.5) as pct
  from settings where key = 'nissim_share_pct'
  union all select 0.5
  where not exists (select 1 from settings where key = 'nissim_share_pct')
  limit 1
)
select
  m.month,
  coalesce(p.income, 0)                         as line1_collected_income,
  coalesce(p.fixed_expenses, 0)                 as line2_approved_fixed,
  coalesce(p.direct_expenses, 0)                as line3_direct,
  coalesce(p.profit, 0)                         as line4_distributable_profit,
  round(coalesce(p.profit, 0) * n.pct, 2)       as line5_nissim_share,
  coalesce(p.profit, 0) - round(coalesce(p.profit, 0) * n.pct, 2) as line5_harel_share,
  coalesce(a.advances, 0)                       as line6_advances
from months m
cross join nissim_pct n
left join profit p on p.month = m.month
left join adv    a on a.month = m.month;

/*
 * v_nissim_card — הכרטיס המלא, עם היתרה המתגלגלת.
 *
 * יתרת הפתיחה של החודש הראשון מגיעה מ-periods.opening_balance
 * ("מנקים שולחן", §3.3). משם הכל מחושב.
 *
 *   שורה 7: יתרה = פתיחה + מקדמות − חלק ניסים
 *   שורה 8: העברה = max(0, −יתרה)
 */
create or replace view v_nissim_card as
with opening as (
  select coalesce(
    (select p.opening_balance
     from periods p
     where p.division = 'finance' and p.opening_balance is not null and p.deleted_at is null
     order by p.year, p.month
     limit 1), 0) as amount,
  coalesce(
    (select to_char(make_date(p.year, p.month, 1), 'YYYY-MM')
     from periods p
     where p.division = 'finance' and p.opening_balance is not null and p.deleted_at is null
     order by p.year, p.month
     limit 1), '0000-00') as from_month
),
ordered as (
  select l.*, o.amount as opening_amount
  from v_nissim_card_lines l
  cross join opening o
  where l.month >= o.from_month
  order by l.month
)
select
  month,
  line1_collected_income,
  line2_approved_fixed,
  line3_direct,
  line4_distributable_profit,
  line5_nissim_share,
  line5_harel_share,
  line6_advances,
  opening_amount
    + sum(line6_advances - line5_nissim_share) over (order by month rows unbounded preceding)
    as line7_closing_balance,
  greatest(0, -(
    opening_amount
    + sum(line6_advances - line5_nissim_share) over (order by month rows unbounded preceding)
  )) as line8_transfer_due
from ordered;

comment on view v_nissim_card is
  'SPEC §3.3 — שורה 7 חיובית: ניסים חייב לחברה. שלילית: החברה חייבת לניסים,
   וההעברה מתבצעת עד ה-10.';

-- ── v_vat — חבות מע"מ (SPEC §3.1) ──────────────────────────────────────────

create or replace view v_vat as
select
  to_char(coalesce(c.date_doc, c.date_cash), 'YYYY-MM') as vat_month,
  c.division,
  -- coalesce ולא NULL: חודש בלי תשומות מוכרות הוא חבות מלאה, לא "אין נתון".
  -- בלי זה sum(...) filter (...) מחזיר NULL והחבות נעלמת (וזה בדיוק ההפך מ-lib/rules/vat.ts).
  coalesce(abs(sum(c.vat_amount) filter (where c.nature = 'income')), 0)
    as output_vat,
  coalesce(abs(sum(c.vat_amount) filter (
    where c.nature = 'expense' and c.invoice_status = 'has_invoice'
  )), 0) as input_vat_claimable,
  -- "כמה כסף אתה מפסיד אם לא תשיג אותן"
  coalesce(abs(sum(c.vat_amount) filter (
    where c.nature = 'expense' and c.invoice_status in ('missing', 'unknown')
  )), 0) as input_vat_missing_invoice,
  count(*) filter (
    where c.nature = 'expense' and c.invoice_status in ('missing', 'unknown')
  ) as missing_invoice_count,
  coalesce(abs(sum(c.vat_amount) filter (where c.nature = 'income')), 0)
    - coalesce(abs(sum(c.vat_amount) filter (
        where c.nature = 'expense' and c.invoice_status = 'has_invoice'
      )), 0) as liability
from v_tx_classified c
where c.certainty = 'actual' and c.nature in ('income', 'expense')
group by 1, 2;

-- ── v_cashflow_13w — תזרים (SPEC §3.6) ─────────────────────────────────────

/*
 * שורות הצפי קדימה: תקבולים מתיקים + הוצאות קבועות + מע"מ.
 * העוגן והצבירה השבועית מחושבים בשכבת ה-TS (lib/rules/cashflow.ts),
 * כי שם יושבת גם ההסתברות לפי שלב והרקב — ובדיקות היחידה מגנות עליהן.
 * ה-view מספק את החומר הגלם באותה צורה בדיוק.
 */
create or replace view v_cashflow_items as
-- תקבולים צפויים
select
  p.expected_date                         as date,
  d.client_name || ' — ' || p.label       as label,
  p.amount_net                            as amount,
  p.certainty::text                       as certainty,
  p.probability,
  'receipt'                               as kind,
  d.division::text                        as division,
  p.id                                    as ref_id
from deal_payments_plan p
join deals d on d.id = p.deal_id
where p.matched_tx_id is null and p.deleted_at is null and d.deleted_at is null

union all

-- הוצאות קבועות: שורה לכל חודש שבו הן מתממשות, 13 שבועות קדימה
select
  make_date(
    extract(year from gs)::int,
    extract(month from gs)::int,
    least(f.day_of_month, extract(day from (date_trunc('month', gs) + interval '1 month - 1 day'))::int)
  )                                       as date,
  f.name                                  as label,
  -abs(f.amount_net)                      as amount,
  'committed'                             as certainty,
  1::numeric                              as probability,
  'fixed_expense'                         as kind,
  f.division::text                        as division,
  f.id                                    as ref_id
from fixed_expenses f
cross join generate_series(
  date_trunc('month', current_date),
  date_trunc('month', current_date) + interval '3 months',
  interval '1 month'
) gs
where f.active
  and f.deleted_at is null
  and f.frequency = 'monthly'
  and gs >= date_trunc('month', f.start_date)
  and (f.end_date is null or gs <= f.end_date);

comment on view v_cashflow_items is
  'SPEC §3.6 — חומר הגלם לשני הקווים. הצבירה השבועית וההסתברות
   לפי שלב מחושבות ב-lib/rules/cashflow.ts, שם יש להן בדיקות יחידה.';

-- ── v_conversion — יחס המרה שבועי (SPEC §3.8) ──────────────────────────────

create or replace view v_conversion as
with weekly_leads as (
  select
    date_trunc('week', l.date + interval '1 day')::date - 1 as week,  -- שבוע שמתחיל בראשון
    l.source_id,
    l.product,
    count(*)                                               as leads,
    count(*) filter (where l.stage <> 'received')          as contacted,
    count(*) filter (where l.stage in ('meeting', 'proposal', 'signed', 'closed_won')) as meetings,
    count(*) filter (where l.stage in ('proposal', 'signed', 'closed_won')) as proposals,
    count(*) filter (where l.stage in ('signed', 'closed_won')) as signings,
    array_agg(l.deal_id) filter (where l.deal_id is not null) as deal_ids
  from leads l
  where l.deleted_at is null
  group by 1, 2, 3
),
weekly_costs as (
  select
    date_trunc('week', c.date + interval '1 day')::date - 1 as week,
    c.source_id,
    sum(abs(c.amount)) as cost
  from lead_costs c
  where c.deleted_at is null
  group by 1, 2
)
select
  wl.week,
  s.name                                        as source_name,
  wl.source_id,
  wl.product,
  wl.leads,
  wl.contacted,
  wl.meetings,
  wl.proposals,
  wl.signings,
  coalesce(rev.collected_deals, 0)              as collections,
  case when wl.leads > 0 then round(wl.signings::numeric / wl.leads, 4) end
    as conversion_to_signing,
  case when wl.leads > 0 then round(coalesce(rev.collected_deals, 0)::numeric / wl.leads, 4) end
    as conversion_to_collection,
  coalesce(wc.cost, 0)                          as lead_cost,
  case when wl.leads > 0 then round(coalesce(wc.cost, 0) / wl.leads, 2) end
    as cost_per_lead,
  case when wl.signings > 0 then round(coalesce(wc.cost, 0) / wl.signings, 2) end
    as cac,
  coalesce(rev.revenue, 0)                      as revenue,
  case when wl.leads > 0 then round(coalesce(rev.revenue, 0) / wl.leads, 2) end
    as revenue_per_lead,
  case when coalesce(wc.cost, 0) > 0 then round(coalesce(rev.revenue, 0) / wc.cost, 2) end
    as roi
from weekly_leads wl
join lead_sources s on s.id = wl.source_id
left join weekly_costs wc on wc.week = wl.week and wc.source_id = wl.source_id
left join lateral (
  select
    sum(b.collected_net)                                as revenue,
    count(*) filter (where b.collected_net > 0)         as collected_deals
  from v_deal_balance b
  where b.deal_id = any(wl.deal_ids)
) rev on true;

comment on view v_conversion is
  'SPEC §3.8 — המשפך ב-₪, לא בכמויות. הכמות היא רק המכנה.';

-- ── תור הפערים (SPEC §4.3, §5 מסך 12) ──────────────────────────────────────

create or replace view v_invoice_gaps as
-- בדיקה 1א: הכנסה בבנק בלי חשבונית
select
  'income_without_invoice'  as gap_kind,
  t.id                      as ref_id,
  t.date_cash               as date,
  t.amount_gross            as amount,
  0::numeric                as vat_at_risk,
  t.counterparty,
  t.description
from transactions t
where t.nature = 'income' and t.certainty = 'actual'
  and t.invoice_id is null and t.invoice_status in ('missing', 'unknown')
  and t.deleted_at is null

union all

-- בדיקה 1ב: חשבונית שהוצאה ואין לה תקבול = חייבים לנו
select
  'invoice_without_receipt',
  i.id, i.date, i.amount_gross, 0, i.counterparty, i.doc_number
from invoices i
where i.direction = 'issued' and i.matched_tx_id is null and i.deleted_at is null

union all

-- בדיקה 2: הוצאה בלי חשבונית ספק — עם המע"מ שמפוספס
select
  'expense_without_invoice',
  t.id, t.date_cash, t.amount_gross, abs(t.vat_amount), t.counterparty, t.description
from transactions t
where t.nature = 'expense' and t.certainty = 'actual'
  and t.invoice_status in ('missing', 'unknown')
  and t.deleted_at is null;

comment on view v_invoice_gaps is
  'SPEC §4.3 — שלוש הבדיקות. vat_at_risk הוא כמה כסף מפסידים אם החשבונית לא תושג.';
