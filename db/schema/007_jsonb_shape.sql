-- ════════════════════════════════════════════════════════════════════════════
-- 007 — עמודות jsonb חייבות להחזיק אובייקט, לא מחרוזת JSON.
--
-- הבאג שזה תופס: `${JSON.stringify(obj)}::jsonb` מפרמטר נשמר כ-JSON *string*
-- ("{\"finance\":0.8}"), ואז `value -> 'finance'` מחזיר NULL בשקט — מפתח חלוקה
-- משותף היה נופל לברירת המחדל בלי שאף אחד ישים לב. עכשיו ה-INSERT נדחה.
-- ════════════════════════════════════════════════════════════════════════════

alter table transactions   add constraint tx_split_is_object
  check (division_split is null or jsonb_typeof(division_split) = 'object');
alter table fixed_expenses add constraint fixed_split_is_object
  check (division_split is null or jsonb_typeof(division_split) = 'object');
alter table employees      add constraint employee_split_is_object
  check (jsonb_typeof(division_split) = 'object');
alter table periods        add constraint period_snapshot_is_object
  check (snapshot_json is null or jsonb_typeof(snapshot_json) = 'object');
alter table employment_terms add constraint terms_components_is_array
  check (jsonb_typeof(components) = 'array');
alter table payroll_months add constraint payroll_adjustments_is_array
  check (jsonb_typeof(manual_adjustments) = 'array');
-- settings מחזיקה גם סקלרים (0.18, 500000) — רק לא מחרוזת שנראית כמו JSON
alter table settings add constraint settings_not_double_encoded
  check (jsonb_typeof(value) <> 'string' or (value #>> '{}') !~ '^\s*[\[{]');
