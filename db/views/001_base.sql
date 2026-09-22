-- ════════════════════════════════════════════════════════════════════════════
-- Views — שכבת בסיס
-- SPEC §1.1 "כל השאר נגזר" · נספח ב ליקוי #1 "אין נוסחאות בתאים, רק views"
-- ════════════════════════════════════════════════════════════════════════════

-- ── מפתחות חלוקה (SPEC §1.2) ───────────────────────────────────────────────

-- ברירת המחדל מההגדרות, כשורה אחת שאפשר ל-JOIN אליה.
create or replace view v_default_split as
select
  coalesce((value -> 'finance')::numeric,    0.8) as finance_pct,
  coalesce((value -> 'realestate')::numeric, 0.2) as realestate_pct
from settings
where key = 'default_division_split'
union all
select 0.8, 0.2
where not exists (select 1 from settings where key = 'default_division_split')
limit 1;

/*
 * v_tx_allocated — כל תנועה, מפורקת לפעילות שאליה היא שייכת.
 *
 * זהו הבסיס שכל דוח פעילות נשען עליו, והמקום היחיד שבו `shared` מתפרק.
 * תנועה משותפת מופיעה כאן *פעמיים* — פעם למימון ופעם לנדל"ן — וסכום שתי
 * השורות שווה לסכום המקורי, כך שאין לא כפילות ולא איבוד.
 *
 * `private` אינה מופיעה כלל (SPEC §2.1).
 */
create or replace view v_tx_allocated as
with split as (select * from v_default_split)
select
  t.id                as tx_id,
  t.date_cash,
  t.date_doc,
  t.account_id,
  t.nature,
  t.category_id,
  t.deal_id,
  t.fixed_expense_id,
  t.partner_id,
  t.tx_class,
  t.deductible,
  t.invoice_status,
  t.review_status,
  t.certainty,
  t.parent_id,
  t.counterparty,
  t.description,
  t.cash_discount,
  to_char(t.date_cash, 'YYYY-MM') as month_cash,
  d.division,
  d.weight,
  round(t.amount_net   * d.weight, 2) as amount_net,
  round(t.vat_amount   * d.weight, 2) as vat_amount,
  round(t.amount_gross * d.weight, 2) as amount_gross
from transactions t
cross join split s
cross join lateral (
  select * from (values
    ('realestate'::concrete_division,
      case
        when t.division = 'realestate' then 1::numeric
        when t.division = 'shared' then
          coalesce((t.division_split -> 'realestate')::numeric, s.realestate_pct)
        else 0
      end),
    ('finance'::concrete_division,
      case
        when t.division = 'finance' then 1::numeric
        when t.division = 'shared' then
          coalesce((t.division_split -> 'finance')::numeric, s.finance_pct)
        else 0
      end)
  ) as v(division, weight)
) d
where t.deleted_at is null
  and t.division <> 'private'
  and d.weight > 0;

comment on view v_tx_allocated is
  'SPEC §1.2 — המקום היחיד בקוד שבו shared מתפרק. כל דוח פעילות עובר דרך כאן.';

/*
 * v_tx_classified — רמת הסיווג.
 *
 * SPEC §2.1: שורת-בת של חיוב אשראי לא נספרת בתזרים; לצורך סיווג וקטגוריות
 * ההפך נכון — הבנות נושאות את הקטגוריה והאב הוא רק סך החיוב בבנק.
 * הדוחות בוחרים: v_tx_classified לרווח והפסד ולמע"מ, v_tx_cash לתזרים.
 */
create or replace view v_tx_classified as
select a.*
from v_tx_allocated a
where a.parent_id is not null
   or not exists (
     select 1 from transactions c
     where c.parent_id = a.tx_id and c.deleted_at is null
   );

/* v_tx_cash — רק תנועות שמייצגות כסף שזז בחשבון. */
create or replace view v_tx_cash as
select * from v_tx_allocated where parent_id is null;

-- ── חודש שיוך עסקה (SPEC §3.4) ─────────────────────────────────────────────

/*
 * v_deal_month — חודש ההתחשבנות של כל תיק.
 *
 * "ברירת מחדל: החודש שבו נכנס התקבול הראשון. ניתן לדריסה ידנית."
 * NULL כאן = תיק בלי חודש; אם יש בו כסף, זה חריג שחוסם סגירה (§3.3).
 */
create or replace view v_deal_month as
select
  d.id as deal_id,
  d.division,
  d.status,
  d.fee_agreed_net,
  coalesce(
    d.month_attributed,
    to_char(
      (select min(t.date_cash)
       from transactions t
       where t.deal_id = d.id
         and t.nature = 'income'
         and t.certainty = 'actual'
         and t.deleted_at is null),
      'YYYY-MM')
  ) as month_attributed,
  d.month_attributed is not null as month_is_manual
from deals d
where d.deleted_at is null;

/*
 * v_deal_balance — נגזרות התיק (SPEC §2.1).
 * מתקן את ליקוי #1 ו-#3 בנספח ב: "נגבה" הוא סכום התנועות בפועל,
 * לא שדה שמישהו הקליד, ולא "כן/לא" שקובע כסף.
 */
create or replace view v_deal_balance as
select
  d.id as deal_id,
  d.client_name,
  d.division,
  d.status,
  d.collection_status,
  d.fee_agreed_net,
  dm.month_attributed,
  coalesce(inc.collected_net, 0)                          as collected_net,
  d.fee_agreed_net - coalesce(inc.collected_net, 0)       as open_balance_net,
  coalesce(exp.direct_costs_net, 0)                       as direct_costs_net,
  coalesce(inc.collected_net, 0) - coalesce(exp.direct_costs_net, 0) as net_contribution,
  coalesce(plan.committed_open, 0)                        as open_committed,
  coalesce(plan.expected_open, 0)                         as open_expected_weighted
from deals d
join v_deal_month dm on dm.deal_id = d.id
left join lateral (
  select sum(t.amount_net) as collected_net
  from transactions t
  where t.deal_id = d.id and t.nature = 'income'
    and t.certainty = 'actual' and t.deleted_at is null
) inc on true
left join lateral (
  select abs(sum(t.amount_net)) as direct_costs_net
  from transactions t
  where t.deal_id = d.id and t.nature = 'expense'
    and t.certainty = 'actual' and t.deleted_at is null
) exp on true
left join lateral (
  select
    sum(p.amount_net) filter (where p.certainty = 'committed') as committed_open,
    sum(p.amount_net * p.probability) filter (where p.certainty = 'expected') as expected_open
  from deal_payments_plan p
  where p.deal_id = d.id and p.matched_tx_id is null and p.deleted_at is null
) plan on true
where d.deleted_at is null;

comment on view v_deal_balance is
  'SPEC נספח א — "נגבה בפועל" ו"פתוח לגביה" הם נגזרות, לא עמודות שמוקלדות.';
