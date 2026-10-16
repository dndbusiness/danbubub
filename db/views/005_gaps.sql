-- ════════════════════════════════════════════════════════════════════════════
-- מסך 12 — פערי חשבוניות (SPEC §4.3 בדיקה 3): 12 חודשים אחורה, לפי חודש.
-- מסך 10 — מע"מ נשען על v_vat הקיים (§3.1).
-- ════════════════════════════════════════════════════════════════════════════

/*
 * v_invoice_gaps_by_month — "טבלת פערים לפי חודש: הכנסות בלי מסמך / מסמכים בלי
 * כסף / הוצאות בלי חשבונית / הפרשי סכום". זה הפלט שנשלח לרו"ח.
 */
create or replace view v_invoice_gaps_by_month as
with months as (
  select to_char(gs, 'YYYY-MM') as month
  from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') gs
),
gaps as (
  select g.gap_kind, to_char(g.date, 'YYYY-MM') as month, g.amount, g.vat_at_risk
  from v_invoice_gaps g
)
select
  m.month,
  count(*) filter (where g.gap_kind = 'income_without_invoice')                  as income_without_invoice,
  coalesce(sum(g.amount) filter (where g.gap_kind = 'income_without_invoice'), 0) as income_without_invoice_amount,
  count(*) filter (where g.gap_kind = 'invoice_without_receipt')                 as invoice_without_receipt,
  coalesce(sum(g.amount) filter (where g.gap_kind = 'invoice_without_receipt'), 0) as invoice_without_receipt_amount,
  count(*) filter (where g.gap_kind = 'expense_without_invoice')                 as expense_without_invoice,
  coalesce(sum(g.amount) filter (where g.gap_kind = 'expense_without_invoice'), 0) as expense_without_invoice_amount,
  coalesce(sum(g.vat_at_risk) filter (where g.gap_kind = 'expense_without_invoice'), 0) as vat_at_risk,
  count(*)                                                                       as total_gaps
from months m
left join gaps g on g.month = m.month
group by m.month
order by m.month;

comment on view v_invoice_gaps_by_month is
  'SPEC §4.3 בדיקה 3 — דוח הפערים ל-12 חודשים. זה הקריטריון של שלב 6.';

/*
 * v_vat_periods — מסך 10: חבות לפי תקופת דיווח, חודשית או דו-חודשית.
 * התקופה נקבעת לפי settings.vat_bimonthly; ברירת מחדל חודשית.
 */
create or replace view v_vat_periods as
with cfg as (
  select coalesce((select (value #>> '{}')::boolean from settings where key = 'vat_bimonthly'), false) as bimonthly
),
base as (
  select
    v.vat_month,
    case when (select bimonthly from cfg)
      -- דו-חודשי: ינואר–פברואר מדווחים יחד כ"01-02".
      then substring(v.vat_month, 1, 5) ||
           lpad((((extract(month from (v.vat_month || '-01')::date)::int + 1) / 2) * 2 - 1)::text, 2, '0') || '/' ||
           lpad((((extract(month from (v.vat_month || '-01')::date)::int + 1) / 2) * 2)::text, 2, '0')
      else v.vat_month end as period,
    v.division, v.output_vat, v.input_vat_claimable, v.input_vat_missing_invoice, v.missing_invoice_count, v.liability
  from v_vat v
)
select
  period,
  min(vat_month)                                as first_month,
  max(vat_month)                                as last_month,
  coalesce(sum(output_vat), 0)                  as output_vat,
  coalesce(sum(input_vat_claimable), 0)         as input_vat_claimable,
  coalesce(sum(input_vat_missing_invoice), 0)   as input_vat_missing_invoice,
  coalesce(sum(missing_invoice_count), 0)::int  as missing_invoice_count,
  coalesce(sum(liability), 0)                   as liability,
  (select bimonthly from cfg)                   as bimonthly
from base
group by period
order by period desc;

comment on view v_vat_periods is
  'SPEC §3.1 — חבות מע"מ לפי תקופת דיווח (חודשית/דו-חודשית לפי ההגדרה).';
