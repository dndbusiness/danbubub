import { createHash } from 'node:crypto'
import * as xlsx from 'xlsx'
import { ACTOR_ID, withActor } from '@/lib/db'
import { instantiateChecklist } from '@/lib/rules/checklist.js'
import { parseWorkbook, type Cell, type ImportBundle } from './workbook.js'

/**
 * כתיבת הקובץ הקיים ל-DB — SPEC §9 שלב 2, §11.9 (idempotent).
 *
 * ה-parsing טהור ויושב ב-workbook.ts; כאן רק הכתיבה. אותה פונקציה משרתת את
 * `scripts/import-workbook.mjs` ואת מסך הייבוא, כדי שלא יהיו שני מסלולי ייבוא
 * שמתפצלים (הנחיה 20 ברוחה).
 *
 * ריצה חוזרת על אותו קובץ = 0 שורות חדשות: האצווה נרשמת לפי sha256 של הקובץ,
 * וכל רשומה נושאת source_ref יציב.
 */

export interface WorkbookLoadResult {
  alreadyImported: boolean
  deals: number
  transactions: number
  advances: number
  plans: number
  warnings: ImportBundle['warnings']
}

export interface WorkbookLoadOptions {
  fileName: string
  /** שנת הקובץ (עמודות החודשים בו הן מספרים). */
  year?: number
  /** תאריך הייבוא — משמש לתקבול שהקובץ השמיט ממנו חודש (ליקוי #2). */
  importDate: string
}

/** קריאת הגיליונות מהקובץ — SheetJS, בלי נגיעה ב-DB. */
export function readWorkbookSheets(buf: Buffer): Parameters<typeof parseWorkbook>[0] {
  const wb = xlsx.read(buf, { cellDates: true })
  const sheet = (name: string): Cell[][] => {
    const ws = wb.Sheets[name]
    if (!ws) throw new Error(`הגיליון "${name}" לא נמצא בקובץ. יש בו: ${wb.SheetNames.join(', ')}`)
    return xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as Cell[][]
  }
  return {
    deals: sheet('עסקאות'),
    expenses: sheet('הוצאות'),
    advances: sheet('מקדמות'),
    nissimCard: wb.Sheets['כרטיס ניסים'] ? sheet('כרטיס ניסים') : undefined,
  }
}

export async function loadWorkbook(buf: Buffer, opts: WorkbookLoadOptions): Promise<WorkbookLoadResult> {
  const year = opts.year ?? Number(opts.importDate.slice(0, 4))
  const bundle = parseWorkbook(readWorkbookSheets(buf), { year, importDate: opts.importDate })
  const counts = { deals: 0, transactions: 0, advances: 0, plans: 0 }

  const alreadyImported = await withActor(async (tx) => {
    const hash = createHash('sha256').update(buf).digest('hex')
    const [batch] = await tx<{ id: string }[]>`
      insert into import_batches (source, file_name, file_hash, rows_total, status, imported_by)
      values ('system', ${opts.fileName}, ${hash},
              ${bundle.deals.length + bundle.transactions.length + bundle.advances.length}, 'applied', ${ACTOR_ID})
      on conflict do nothing returning id`
    if (!batch) return true

    const [account] = await tx<{ id: string }[]>`
      select id from accounts where deleted_at is null and type = 'bank' order by created_at limit 1`
    if (!account) throw new Error('אין חשבון בנק בטבלת accounts — יש להגדיר אחד לפני הייבוא')

    const categories = new Map(
      (await tx<{ id: string; name: string }[]>`select id, name from categories where deleted_at is null`)
        .map((c) => [c.name, c.id] as const),
    )
    const catId = (name?: string | null) => (name && categories.get(name)) ?? categories.get('שונות') ?? null
    const [vat] = await tx<{ rate: number }[]>`select rate from vat_rates order by valid_from desc limit 1`
    const vatRate = vat?.rate ?? 0.18

    const dealIdByRef = new Map<string, string | undefined>()
    for (const d of bundle.deals) {
      const [row] = await tx<{ id: string }[]>`
        insert into deals (client_name, division, product, stage, status, collection_status, fee_agreed_net, fee_mode, fee_pct, base_amount,
                           month_attributed, expected_close_date, notes, wise_ref, last_activity_at)
        values (${d.clientName}, 'finance', ${d.product}, ${d.stage}, ${d.status}, ${d.collectionStatus}, ${d.feeAgreedNet}, ${d.feeMode},
                ${d.feePct ?? null}, ${d.baseAmount ?? null}, ${d.monthAttributed ?? null}, ${d.expectedCollectionDate ?? null},
                ${[d.notes, d.lenders.length ? `גופי מימון: ${d.lenders.join(', ')}` : null, d.approvedBy ? `אושר ב: ${d.approvedBy}` : null]
                    .filter(Boolean).join(' · ') || null},
                ${d.sourceRef}, now())
        on conflict (wise_ref) where wise_ref is not null do nothing
        returning id`
      let id = row?.id
      if (!id) {
        const [existing] = await tx<{ id: string }[]>`select id from deals where wise_ref = ${d.sourceRef}`
        id = existing?.id
      } else counts.deals++
      dealIdByRef.set(d.sourceRef, id)

      // ADDENDUM ב.5 — צ'קליסט הביצוע נולד מתבנית לפי מוצר. בלעדיו "מה חסר כדי
      // לקבל את הכסף" ריק, וזה בדיוק מה שהמסך אמור לענות עליו.
      if (id) {
        for (const it of instantiateChecklist(id, d.product)) {
          await tx`
            insert into deal_checklist_items (deal_id, sort_order, label, status_since)
            values (${id}, ${it.sortOrder}, ${it.label}, current_date)
            on conflict (deal_id, sort_order) do nothing`
        }
        // מה שכבר קרה — מסומן: הסכם נחתם אם התיק לא "פוטנציאל", וכסף שנכנס = נגבה.
        if (d.stage !== 'prospect') {
          await tx`update deal_checklist_items set status = 'done'
                   where deal_id = ${id} and sort_order = 1 and status = 'pending'`
        }
        const collected = bundle.transactions
          .filter((t) => t.dealSourceRef === d.sourceRef && t.nature === 'income')
          .reduce((a, t) => a + t.amountNet, 0)
        if (collected > 0) {
          await tx`update deal_checklist_items set status = 'done', auto_source = 'transaction'
                   where deal_id = ${id} and label like 'שכ%נגבה' and status = 'pending'`
        }
        if (collected >= d.feeAgreedNet && d.feeAgreedNet > 0) {
          await tx`update deal_checklist_items set status = 'done', auto_source = 'transaction'
                   where deal_id = ${id} and status = 'pending'`
        }
      }

      // יתרה פתוחה → לוח תקבולים "על בסיס הצלחה" (expected) — SPEC §2.1
      if (row && d.status === 'open') {
        const collected = bundle.transactions
          .filter((t) => t.dealSourceRef === d.sourceRef && t.nature === 'income')
          .reduce((a, t) => a + t.amountNet, 0)
        const open = Math.round((d.feeAgreedNet - collected) * 100) / 100
        if (open > 0) {
          await tx`
            insert into deal_payments_plan (deal_id, label, amount_net, expected_date, certainty, probability)
            values (${id!}, 'יתרה על בסיס הצלחה', ${open}, ${d.expectedCollectionDate ?? opts.importDate}, 'expected', 0.5)`
          counts.plans++
        }
      }

      // הגשות לגופי מימון (SPEC §4.5 deal_submissions) — מהעמודה "גופי מימון"
      if (row) {
        for (const bank of d.lenders) {
          await tx`
            insert into deal_submissions (deal_id, bank, status, wise_ref)
            values (${id!}, ${bank}, ${d.approvedBy?.includes(bank) ? 'approved' : 'submitted'}, ${`${d.sourceRef}:${bank}`})
            on conflict do nothing`
        }
      }

      // פרייבט 1% (SPEC §2.1 private_income) — צפוי, לא של החברה
      if (row && d.privateOnePct) {
        await tx`
          insert into private_income (fund_name, deal_ref, deal_amount, pct, amount_net, status, note)
          values ('קרן (מהקובץ)', ${d.clientName}, ${d.baseAmount ?? null}, 0.01, ${d.privateOnePct}, 'expected',
                  ${`יובא מהקובץ — ${d.sourceRef}`})`
      }
    }

    for (const t of bundle.transactions) {
      const [row] = await tx<{ id: string }[]>`
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
      const [existing] = await tx`
        select 1 from transactions where source = 'system' and source_ref = ${a.sourceRef} and deleted_at is null`
      if (existing) continue
      const [t] = await tx<{ id: string }[]>`
        insert into transactions (date_cash, account_id, amount_net, vat_mode, vat_rate, nature, division, tx_class,
                                  invoice_status, counterparty, description, source, source_ref)
        values (${a.date}, ${account.id}, ${-a.amountGross}, 'exempt', 0, 'advance', 'finance', 'business',
                'no_invoice_needed', 'ניסים', ${a.note ?? 'מקדמה — יובא מהקובץ'}, 'system', ${a.sourceRef})
        returning id`
      await tx`
        insert into advances (date, amount_gross, method, tx_id, period, note)
        values (${a.date}, ${a.amountGross}, ${a.method}, ${t!.id}, ${a.period}, ${a.note ?? null})`
      counts.advances++
    }

    // SPEC §3.3 "מנקים שולחן": בקובץ היתרה מתחילה מאפס בחודש הראשון שיש בו נתונים.
    const first = bundle.fileNissimCard.find((m) => m.income || m.deductible || m.direct || m.advances)
    if (first) {
      const [y, m] = first.month.split('-').map(Number)
      await tx`
        insert into periods (division, year, month, status, opening_balance)
        values ('finance', ${y!}, ${m!}, 'open', 0)
        on conflict (division, year, month) do nothing`
    }

    await tx`
      update import_batches set rows_created = ${counts.deals + counts.transactions + counts.advances}
      where id = ${batch.id}`
    return false
  })

  return { alreadyImported, ...counts, warnings: bundle.warnings }
}
