/**
 * מייצר seed SQL מתוך אותו פיקסצ'ר ש-vitest משתמש בו.
 *
 * הסיבה: הנוסחאות של §3 קיימות פעמיים — כפונקציות ב-/lib/rules וכ-views ב-SQL.
 * שתי המימושים חייבים להחזיר את אותו מספר. הסקריפט הזה מזין לשניהם את אותם
 * נתונים בדיוק, כדי שאי אפשר יהיה לתקן אחד ולשכוח את השני.
 *
 * שימוש:  node scripts/fixture-to-sql.mjs > /tmp/seed.sql
 */

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

const { transactions, deals, fixedExpenses, advances, OPENING_BALANCE, DEFAULT_SPLIT } =
  await import('../tests/fixtures/nissim-card-2026.ts')

const q = (v) =>
  v === undefined || v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const num = (v) => (v === undefined || v === null ? 'null' : Number(v).toFixed(2))
const bool = (v) => (v === undefined || v === null ? 'null' : v ? 'true' : 'false')
const uuid = (prefix, id) => `'${hashToUuid(prefix + id)}'`

// מזהה יציב מתוך מחרוזת, כדי ששתי הרצות ייצרו את אותם UUID.
function hashToUuid(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 + s.charCodeAt(i), 0x85ebca6b) >>> 0
  }
  const hex = (n) => n.toString(16).padStart(8, '0')
  const raw = (hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(h1 + h2)).slice(0, 32)
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-8${raw.slice(17, 20)}-${raw.slice(20, 32)}`
}

const out = []
out.push('begin;')
out.push(`set local app.current_user_id = '00000000-0000-4000-8000-000000000001';`)

out.push(`insert into users (id, email, full_name, role)
  values ('00000000-0000-4000-8000-000000000001', 'seed@harel.local', 'Seed', 'admin')
  on conflict (email) do nothing;`)

out.push(`insert into settings (key, value) values
  ('default_division_split', '${JSON.stringify(DEFAULT_SPLIT)}'::jsonb),
  ('nissim_share_pct', '0.5'::jsonb)
  on conflict (key) do update set value = excluded.value;`)

out.push(`insert into entities (id, name, type) values
  ('${hashToUuid('ent-harel')}', 'א.ד.י הראל השקעות', 'company');`)

out.push(`insert into accounts (id, entity_id, type, name, default_division) values
  ('${hashToUuid('acc-bank')}', '${hashToUuid('ent-harel')}', 'bank', 'עו״ש', 'finance');`)

// הקטגוריות נגזרות מהפיקסצ'ר עצמו (מזהים בצורת "cat:<שם>")
const categories = new Set([...transactions.map((t) => t.categoryId), ...fixedExpenses.map((f) => f.categoryId)].filter(Boolean))
for (const c of categories) {
  out.push(`insert into categories (id, name, kind) values (${uuid('', c)}, ${q(String(c).replace(/^cat:/, ''))}, 'fixed');`)
}

for (const f of fixedExpenses) {
  out.push(`insert into fixed_expenses
    (id, name, category_id, division, division_split, amount_net, vat_mode, frequency,
     day_of_month, account_id, variable, approved_by_nissim, start_date, active)
    values (${uuid('', f.id)}, ${q(f.name)}, ${uuid('', f.categoryId)}, ${q(f.division)},
      ${f.divisionSplit ? `'${JSON.stringify(f.divisionSplit)}'::jsonb` : 'null'},
      ${num(f.amountNet)}, ${q(f.vatMode)}, ${q(f.frequency)}, ${f.dayOfMonth},
      '${hashToUuid('acc-bank')}', ${bool(f.variable)}, ${bool(f.approvedByNissim)},
      ${q(f.startDate)}, true);`)
}

for (const d of deals) {
  out.push(`insert into deals
    (id, client_name, division, product, stage, collection_status, fee_agreed_net,
     fee_mode, month_attributed, status, signed_at)
    values (${uuid('', d.id)}, ${q(d.clientName)}, ${q(d.division)}, ${q(d.product)},
      ${q(d.stage)}, ${q(d.collectionStatus)}, ${num(d.feeAgreedNet)}, ${q(d.feeMode)},
      ${q(d.monthAttributed)}, ${q(d.status)}, ${q(d.signedAt)});`)
}
// שותף לתנועות draw
out.push(`insert into partners (id, name, division, share_pct, pay_method)
  values ('${hashToUuid('partner-dan')}', 'דן', 'finance', 0.5, 'invoice');`)

for (const t of transactions) {
  const needsPartner = t.nature === 'draw'
  out.push(`insert into transactions
    (id, date_cash, account_id, amount_net, vat_mode, vat_rate, nature, division,
     division_split, category_id, tx_class, deductible, fixed_expense_id, deal_id,
     partner_id, description, certainty, parent_id, invoice_status, review_status,
     cash_discount)
    values (${uuid('', t.id)}, ${q(t.dateCash)}, '${hashToUuid('acc-bank')}',
      ${num(t.amountNet)}, ${q(t.vatMode)}, ${t.vatRate}, ${q(t.nature)}, ${q(t.division)},
      ${t.divisionSplit ? `'${JSON.stringify(t.divisionSplit)}'::jsonb` : 'null'},
      ${t.categoryId ? uuid('', t.categoryId) : 'null'}, ${q(t.txClass)},
      ${bool(t.deductible)},
      ${t.fixedExpenseId ? uuid('', t.fixedExpenseId) : 'null'},
      ${t.dealId ? uuid('', t.dealId) : 'null'},
      ${needsPartner ? `'${hashToUuid('partner-dan')}'` : 'null'},
      ${q(t.description)}, 'actual', null, ${q(t.invoiceStatus)}, ${q(t.reviewStatus ?? 'ok')},
      ${bool(t.cashDiscount ?? false)});`)
}

for (const a of advances) {
  out.push(`insert into advances (id, date, amount_gross, method, period)
    values (${uuid('', a.id)}, ${q(a.date)}, ${num(a.amountGross)}, ${q(a.method)}, ${q(a.period)});`)
}

// SPEC §3.3 "מנקים שולחן" — יתרת הפתיחה מוזנת ידנית פעם אחת.
out.push(`insert into periods (division, year, month, status, opening_balance)
  values ('finance', 2026, 7, 'open', ${num(OPENING_BALANCE)});`)

out.push('commit;')
console.log(out.join('\n'))
