-- ════════════════════════════════════════════════════════════════════════════
-- מסך 8 — משיכות שותפים נדל"ן (SPEC §3.5) · מסך 9 — הכנסות פרייבט (§2.1).
--
-- §3.5 שונה מ-§3.2 בשתי נקודות, וזה מה שה-views האלה מקודדים:
--   • אין דרישת "מאושר ע"י ניסים" בנדל"ן.
--   • ההכנסה נספרת בלי דרישת deal_id (בניגוד ל-v_pnl_distributable).
-- זהות מלאה מול lib/rules/realestate.ts — נבדקת ב-db/tests/003_realestate.sql.
-- ════════════════════════════════════════════════════════════════════════════

/*
 * v_realestate_profit — רווח לחלוקה בנדל"ן לפי חודש.
 *   income actual (realestate + shared×split) − expense actual deductible.
 */
create or replace view v_realestate_profit as
select
  c.month_cash                                                              as month,
  coalesce(sum(c.amount_net) filter (where c.nature = 'income'), 0)         as income,
  abs(coalesce(sum(c.amount_net) filter (
    where c.nature = 'expense' and c.deductible is true), 0))               as expenses,
  coalesce(sum(c.amount_net) filter (where c.nature = 'income'), 0)
    - abs(coalesce(sum(c.amount_net) filter (
        where c.nature = 'expense' and c.deductible is true), 0))           as profit
from v_tx_classified c
where c.division = 'realestate' and c.certainty = 'actual'
  and c.nature in ('income', 'expense')
group by c.month_cash;

comment on view v_realestate_profit is
  'SPEC §3.5 — רווח לחלוקה בנדל"ן. בלי דרישת אישור ובלי דרישת deal_id.';

/*
 * v_realestate_profit_year — אותו דבר לפי שנה, כי היעד השוויוני הוא YTD.
 */
create or replace view v_realestate_profit_year as
select
  substring(month, 1, 4)  as year,
  sum(income)             as income,
  sum(expenses)           as expenses,
  sum(profit)             as profit
from v_realestate_profit
group by substring(month, 1, 4);

/*
 * v_partner_positions — לכל שותף נדל"ן, לכל שנה:
 *   משיכה בפועל (salary + management_fee + dividend) · יעד שוויוני (רווח ÷ שותפים)
 *   · סטייה · חו"ז בעלים (owner_loan − loan_repayment).
 *
 * השנים נלקחות מאיחוד השנים שיש בהן רווח ושיש בהן משיכה, כדי ששנה עם משיכות
 * בלי רווח (או להפך) לא תיעלם מהמסך.
 */
create or replace view v_partner_positions as
with years as (
  select year from v_realestate_profit_year
  union
  select to_char(d.date, 'YYYY') from partner_draws d
  join partners p on p.id = d.partner_id
  where d.deleted_at is null and p.division = 'realestate' and p.deleted_at is null
  union
  -- השנה הנוכחית תמיד מופיעה: מסך שמראה "אין שותפים" כשעוד לא קרה כלום
  -- הוא מסך שבור, לא מסך ריק.
  select to_char(current_date, 'YYYY')
),
active_partners as (
  select id, name, share_pct, pay_method, investor_loan_opening
  from partners
  where division = 'realestate' and active and deleted_at is null
),
n as (select count(*)::numeric as cnt from active_partners),
draws as (
  select
    p.id as partner_id,
    to_char(d.date, 'YYYY') as year,
    coalesce(sum(abs(d.amount)) filter (
      where d.type in ('salary', 'management_fee', 'dividend')), 0) as drawn,
    coalesce(sum(abs(d.amount)) filter (where d.type = 'owner_loan'), 0)      as owner_loans,
    coalesce(sum(abs(d.amount)) filter (where d.type = 'loan_repayment'), 0)  as repayments,
    count(*) filter (where d.type in ('salary', 'management_fee', 'dividend'))::int as draw_count
  from active_partners p
  join partner_draws d on d.partner_id = p.id and d.deleted_at is null
  group by p.id, to_char(d.date, 'YYYY')
)
select
  y.year,
  p.id                                                        as partner_id,
  p.name,
  p.pay_method,
  coalesce(pr.profit, 0)                                      as distributable_profit,
  -- היעד השוויוני: רווח ÷ מספר השותפים הפעילים (33/33/33 כששלושה).
  round(coalesce(pr.profit, 0) / nullif((select cnt from n), 0), 2) as target,
  coalesce(d.drawn, 0)                                        as drawn,
  coalesce(d.drawn, 0)
    - round(coalesce(pr.profit, 0) / nullif((select cnt from n), 0), 2) as variance,
  coalesce(d.owner_loans, 0) - coalesce(d.repayments, 0)      as owner_loan_balance,
  coalesce(d.owner_loans, 0)                                  as owner_loans,
  coalesce(d.repayments, 0)                                   as loan_repayments,
  coalesce(d.draw_count, 0)                                   as draw_count,
  p.investor_loan_opening
from years y
cross join active_partners p
left join v_realestate_profit_year pr on pr.year = y.year
left join draws d on d.partner_id = p.id and d.year = y.year;

comment on view v_partner_positions is
  'SPEC §3.5 — 33/33/33: משיכה בפועל מול יעד שוויוני YTD, וחו"ז בעלים בנפרד.';

/*
 * v_investor_loan — חוב המשקיע (יוני, §3.5), "מוצג עם קצב ירידה".
 * יתרת הפתיחה יושבת על השותף; 0 = טרם הוזנה (שאלה #8).
 */
create or replace view v_investor_loan as
with repay as (
  select
    d.partner_id,
    coalesce(sum(abs(d.amount)), 0)                         as repaid,
    count(distinct to_char(d.date, 'YYYY-MM'))::int         as months_with_repayment,
    max(d.date)                                             as last_repayment
  from partner_draws d
  where d.type = 'loan_repayment' and d.deleted_at is null
  group by d.partner_id
)
select
  p.id                                                      as partner_id,
  p.name,
  p.investor_loan_opening                                   as opening_balance,
  coalesce(r.repaid, 0)                                     as repaid,
  p.investor_loan_opening - coalesce(r.repaid, 0)           as balance,
  case when coalesce(r.months_with_repayment, 0) > 0
       then round(r.repaid / r.months_with_repayment, 2) end as average_monthly_repayment,
  case when coalesce(r.months_with_repayment, 0) > 0 and r.repaid > 0
       then ceil((p.investor_loan_opening - r.repaid) /
                 (r.repaid / r.months_with_repayment))::int end as months_to_clear,
  r.last_repayment
from partners p
left join repay r on r.partner_id = p.id
where p.deleted_at is null and p.investor_loan_opening > 0;

comment on view v_investor_loan is
  'SPEC §3.5 — חוב המשקיע: פתיחה פחות החזרים, עם קצב ההחזר החודשי הממוצע.';

/*
 * v_cash_discount — נכיון מזומן. §3.5: "מוצג בנפרד בדוח (לא מוסתר)".
 */
create or replace view v_cash_discount as
select
  c.tx_id,
  c.division,
  c.month_cash                as month,
  c.date_cash                 as date,
  c.counterparty,
  c.description,
  c.amount_net,
  c.amount_gross
from v_tx_classified c
where c.cash_discount is true and c.nature = 'income' and c.certainty = 'actual';

comment on view v_cash_discount is
  'SPEC §3.5 — נכיון מזומן מוצג בנפרד ולעולם לא מוסתר מהדוח.';

/*
 * v_private_income — מסך 9. §2.1: נפרד לחלוטין מהחברה; הטבלה לא נוגעת
 * ב-transactions ולא ב-v_tx_allocated, וגם ה-view הזה לא.
 */
create or replace view v_private_income as
select
  i.id,
  i.fund_name,
  i.deal_ref,
  i.deal_amount,
  i.threshold_rule,
  i.pct,
  i.amount_net,
  i.vat_amount,
  i.amount_net + i.vat_amount            as amount_gross,
  i.split_dan,
  i.split_nissim,
  round(i.amount_net * i.split_dan, 2)    as dan_amount,
  round(i.amount_net * i.split_nissim, 2) as nissim_amount,
  i.received_date,
  i.received_to,
  i.status,
  i.note,
  case when i.received_date is not null then to_char(i.received_date, 'YYYY-MM') end as month_received
from private_income i
where i.deleted_at is null;

/*
 * v_private_income_summary — צפוי מול התקבל, ולכל אחד מהשניים.
 * מה שמתקבל מתחלק לפי ה-split של אותה שורה, ולא לפי ממוצע.
 */
create or replace view v_private_income_summary as
select
  status,
  count(*)::int             as rows_count,
  sum(amount_net)           as amount_net,
  sum(vat_amount)           as vat_amount,
  sum(dan_amount)           as dan_amount,
  sum(nissim_amount)        as nissim_amount
from v_private_income
group by status;

comment on view v_private_income is
  'SPEC §2.1, מסך 9 — הכנסות פרייבט. לא מצטרף לשום שאילתה עסקית.';
