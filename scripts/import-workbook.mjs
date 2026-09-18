/**
 * ייבוא חד-פעמי מהקובץ הקיים → DB. SPEC §9 שלב 2, §11.9 (idempotent).
 *
 *   node --experimental-strip-types scripts/import-workbook.mjs <file.xlsx> [--year 2026] [--as-of YYYY-MM-DD] [--dry-run]
 *
 * ריצה חוזרת על אותו קובץ = 0 שורות חדשות: כל רשומה נושאת source_ref יציב
 * (wb:<גיליון>:<שורה>[:income|:direct]) והכנסה היא ON CONFLICT DO NOTHING.
 * לא מעדכן רשומות קיימות — שינוי אחרי הייבוא נעשה במערכת (הקובץ מוקפא).
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import xlsx from 'xlsx'
import postgres from 'postgres'
import { parseWorkbook } from '../lib/import/workbook.ts'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { year: { type: 'string', default: '2026' }, 'as-of': { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
})
const file = positionals[0]
if (!file) { console.error('שימוש: import-workbook.mjs <file.xlsx> [--year 2026] [--as-of YYYY-MM-DD] [--dry-run]'); process.exit(1) }

const importDate = args['as-of'] ?? new Date().toISOString().slice(0, 10)
const wb = xlsx.read(readFileSync(file), { cellDates: true })
const sheet = (name) => {
  const ws = wb.Sheets[name]
  if (!ws) throw new Error(`הגיליון "${name}" לא נמצא. יש: ${wb.SheetNames.join(', ')}`)
  return xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
}

const bundle = parseWorkbook(
  { deals: sheet('עסקאות'), expenses: sheet('הוצאות'), advances: sheet('מקדמות'), nissimCard: wb.Sheets['כרטיס ניסים'] ? sheet('כרטיס ניסים') : undefined },
  { year: Number(args.year), importDate },
)

console.log(`→ ${bundle.deals.length} תיקים · ${bundle.transactions.length} תנועות · ${bundle.advances.length} מקדמות · ${bundle.warnings.length} אזהרות`)
for (const w of bundle.warnings) console.log(`   ⚠ ${w.kind}  ${w.sourceRef}  ${w.message}`)

if (args['dry-run']) process.exit(0)

// DATABASE_URL מהסביבה, או מ-.env.local (כמו Next) — כדי שאותו קובץ ישמש גם את הסקריפט.
let url = process.env.DATABASE_URL
if (!url) {
  try {
    const env = readFileSync('.env.local', 'utf8')
    url = env.split('\n').map((l) => l.trim()).find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '')
  } catch { /* אין קובץ */ }
}
if (!url) { console.error('DATABASE_URL לא מוגדר (סביבה או .env.local)'); process.exit(1) }
const sql = postgres(url, { transform: { undefined: null } })
const ACTOR = process.env.HAREL_ACTOR_ID ?? '00000000-0000-4000-8000-000000000001'

const counts = { deals: 0, transactions: 0, advances: 0, plans: 0, batch: 0 }
await sql.begin(async (tx) => {
  await tx`select set_config('app.current_user_id', ${ACTOR}, true)`

  // ייבוא = batch אחד לפי hash הקובץ (§11.9). קובץ שכבר יובא — יוצאים.
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
  const [batch] = await tx`
    insert into import_batches (source, file_name, file_hash, rows_total, status, imported_by)
    values ('system', ${file.split('/').pop()}, ${hash}, ${bundle.deals.length + bundle.transactions.length + bundle.advances.length}, 'applied', ${ACTOR})
    on conflict do nothing returning id`
  if (!batch) { console.log('→ הקובץ הזה כבר יובא (אותו hash). 0 שורות חדשות.'); return }
  counts.batch = 1

  const [account] = await tx`select id from accounts where deleted_at is null and type = 'bank' order by created_at limit 1`
  if (!account) throw new Error('אין חשבון בנק בטבלת accounts — יש להגדיר קודם (שלב 0)')
  const categories = new Map((await tx`select id, name from categories where deleted_at is null`).map((c) => [c.name, c.id]))
  const catId = (name) => categories.get(name) ?? categories.get('שונות')
  const [vat] = await tx`select rate from vat_rates order by valid_from desc limit 1`
  const vatRate = vat?.rate ?? 0.18

  const dealIdByRef = new Map()
  for (const d of bundle.deals) {
    const [row] = await tx`
      insert into deals (client_name, division, product, stage, status, collection_status, fee_agreed_net, fee_mode, fee_pct, base_amount,
                         month_attributed, expected_close_date, notes, wise_ref, last_activity_at)
      values (${d.clientName}, 'finance', ${d.product}, ${d.stage}, ${d.status}, ${d.collectionStatus}, ${d.feeAgreedNet}, ${d.feeMode}, ${d.feePct ?? null}, ${d.baseAmount ?? null},
              ${d.monthAttributed ?? null}, ${d.expectedCollectionDate ?? null},
              ${[d.notes, d.lenders.length ? `גופי מימון: ${d.lenders.join(', ')}` : null, d.approvedBy ? `אושר ב: ${d.approvedBy}` : null].filter(Boolean).join(' · ') || null},
              ${d.sourceRef}, now())
      on conflict (wise_ref) where wise_ref is not null do nothing
      returning id`
    let id = row?.id
    if (!id) { const [ex] = await tx`select id from deals where wise_ref = ${d.sourceRef}`; id = ex?.id } else counts.deals++
    dealIdByRef.set(d.sourceRef, id)

    // יתרה פתוחה → לוח תקבולים "על בסיס הצלחה" (expected) — SPEC §2.1
    if (row && d.status === 'open') {
      const open = Math.round((d.feeAgreedNet - bundle.transactions.filter((t) => t.dealSourceRef === d.sourceRef && t.nature === 'income').reduce((a, t) => a + t.amountNet, 0)) * 100) / 100
      if (open > 0) {
        await tx`insert into deal_payments_plan (deal_id, label, amount_net, expected_date, certainty, probability)
                 values (${id}, 'יתרה על בסיס הצלחה', ${open}, ${d.expectedCollectionDate ?? importDate}, 'expected', 0.5)`
        counts.plans++
      }
    }
    // הגשות לגופי מימון (SPEC §4.5 deal_submissions) — מהעמודה "גופי מימון"
    if (row) for (const bank of d.lenders) {
      await tx`insert into deal_submissions (deal_id, bank, status, wise_ref) values (${id}, ${bank}, ${d.approvedBy?.includes(bank) ? 'approved' : 'submitted'}, ${`${d.sourceRef}:${bank}`}) on conflict do nothing`
    }
    // פרייבט 1% (SPEC §2.1 private_income) — צפוי, לא של החברה
    if (row && d.privateOnePct) {
      await tx`insert into private_income (fund_name, deal_ref, deal_amount, pct, amount_net, status, note)
               values ('קרן (מהקובץ)', ${d.clientName}, ${d.baseAmount ?? null}, 0.01, ${d.privateOnePct}, 'expected', ${`יובא מהקובץ — ${d.sourceRef}`})`
    }
  }

  for (const t of bundle.transactions) {
    const [row] = await tx`
      insert into transactions (date_cash, account_id, amount_net, vat_mode, vat_rate, nature, division, category_id, tx_class, deductible,
                                deal_id, counterparty, description, invoice_status, review_status, source, source_ref)
      values (${t.dateCash}, ${account.id}, ${t.amountNet}, 'excl', ${vatRate}, ${t.nature}, 'finance',
              ${t.nature === 'expense' ? catId(t.categoryName) : null}, 'business', ${t.nature === 'expense' ? (t.deductible ?? true) : null},
              ${t.dealSourceRef ? dealIdByRef.get(t.dealSourceRef) ?? null : null}, ${t.counterparty ?? null}, ${t.description ?? null},
              'unknown', ${t.reviewStatus ?? 'ok'}, 'system', ${t.sourceRef})
      on conflict (account_id, source, source_ref) where source_ref is not null and deleted_at is null do nothing
      returning id`
    if (row) counts.transactions++
  }

  for (const a of bundle.advances) {
    const [ex] = await tx`select 1 from transactions where source = 'system' and source_ref = ${a.sourceRef} and deleted_at is null`
    if (ex) continue
    const [t] = await tx`
      insert into transactions (date_cash, account_id, amount_net, vat_mode, vat_rate, nature, division, tx_class, invoice_status, counterparty, description, source, source_ref)
      values (${a.date}, ${account.id}, ${-a.amountGross}, 'exempt', 0, 'advance', 'finance', 'business', 'no_invoice_needed', 'ניסים', ${a.note ?? 'מקדמה — יובא מהקובץ'}, 'system', ${a.sourceRef})
      returning id`
    await tx`insert into advances (date, amount_gross, method, tx_id, period, note) values (${a.date}, ${a.amountGross}, ${a.method}, ${t.id}, ${a.period}, ${a.note ?? null})`
    counts.advances++
  }

  // SPEC §3.3 "מנקים שולחן": בקובץ היתרה מתחילה מאפס בחודש הראשון שיש בו נתונים.
  const first = bundle.fileNissimCard.find((m) => m.income || m.deductible || m.direct || m.advances)
  if (first) {
    const [y, m] = first.month.split('-').map(Number)
    await tx`insert into periods (division, year, month, status, opening_balance) values ('finance', ${y}, ${m}, 'open', 0) on conflict (division, year, month) do nothing`
  }
  await tx`update import_batches set rows_created = ${counts.deals + counts.transactions + counts.advances} where id = ${batch.id}`
})
await sql.end()
console.log(`✓ נוצרו: ${counts.deals} תיקים · ${counts.transactions} תנועות · ${counts.advances} מקדמות · ${counts.plans} שורות לוח תקבולים`)
