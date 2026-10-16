-- ════════════════════════════════════════════════════════════════════════════
-- Bootstrap — הגדרות מינימליות כדי שהמערכת תוכל לקלוט נתונים.
-- זו קונפיגורציה (SPEC §5 מסך 18), לא נתוני דמו: אין כאן אף סכום עסקי.
-- שלב 0 (§9) אמור להחליף את הערכים האלה בערכים האמיתיים (ח.פ, שם חשבון, וכו').
-- ════════════════════════════════════════════════════════════════════════════

insert into users (id, email, full_name, role)
values ('00000000-0000-4000-8000-000000000001', 'danbusiness1000@gmail.com', 'דן', 'admin')
on conflict (email) do nothing;

insert into settings (key, value, description) values
  ('vat_rate',               '0.18'::jsonb,                          'SPEC §3.1 — שיעור מע"מ'),
  ('default_division_split', '{"finance":0.8,"realestate":0.2}',     'SPEC §1.2 — הדס 80/20'),
  ('nissim_share_pct',       '0.5'::jsonb,                           'SPEC §3.3 — חלק ניסים'),
  ('monthly_profit_target',  '500000'::jsonb,                        'SPEC §5.1 — קו יעד חודשי (מהקובץ: הגדרות!B6)'),
  ('yearly_profit_target',   '3000000'::jsonb,                       'SPEC §5.1 — יעד שנתי (מהקובץ: הגדרות!B7)'),
  ('risk_mode_critical_count', '5'::jsonb,                           'ADDENDUM ב.11')
on conflict (key) do nothing;

insert into vat_rates (valid_from, rate) values ('2025-01-01', 0.18) on conflict (valid_from) do nothing;

-- SPEC §2.1 entities: א.ד.י הראל השקעות (ח.פ 516857083), D&D (ע.מ), עדן הובלות ובנייה
insert into entities (id, name, type, vat_id) values
  ('10000000-0000-4000-8000-000000000001', 'א.ד.י הראל השקעות', 'company', '516857083'),
  ('10000000-0000-4000-8000-000000000002', 'די.אנד.די עסקים (ע.מ)', 'sole_proprietor', null),
  ('10000000-0000-4000-8000-000000000003', 'עדן הובלות ובנייה', 'company', null)
on conflict (id) do nothing;

-- חשבון הבנק המשותף (SPEC §2.2 "חשבון אחד"). הבנק עצמו — שאלה פתוחה #1.
insert into accounts (id, entity_id, type, name, default_division)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'bank', 'עו"ש — החשבון המשותף', 'finance')
on conflict (id) do nothing;

-- שותפים (SPEC §2.1 partners)
insert into partners (id, name, division, share_pct, pay_method) values
  ('30000000-0000-4000-8000-000000000001', 'ניסים', 'finance',    0.5,     'invoice'),
  ('30000000-0000-4000-8000-000000000002', 'דן',    'realestate', 0.33333, 'invoice'),
  ('30000000-0000-4000-8000-000000000003', 'אביב',  'realestate', 0.33333, 'invoice'),
  ('30000000-0000-4000-8000-000000000004', 'יוני',  'realestate', 0.33333, 'payslip')
on conflict (id) do nothing;
