/**
 * טעינת ייצוא חשבונית ירוקה ל-DB — SPEC §4.3.
 * הפענוח טהור (lib/import/greeninvoice.ts); כאן רק הכתיבה, ה-idempotency והשידוך.
 */
import { createHash } from 'node:crypto'
import { sql, withActor } from '@/lib/db'
import { rowsFromBuffer } from './rows'
import { isPartnerSupplier, parseGreenInvoiceExport, type GreenInvoiceDirection, type GreenInvoiceRow } from './greeninvoice'
import { INVOICE_MATCH, matchTarget } from '@/lib/match/invoices'
import { normalizeName } from '@/lib/intake/extract'

export interface GreenInvoiceLoadResult {
  batchId: string
  existing?: boolean
  created: number
  duplicatesInFile: number
  alreadyInSystem: number
  matched: number
  partnerReview: number
  totals: { gross: number; vat: number; open: number; reported: number }
  warnings: string[]
}

export async function loadGreenInvoiceExport(
  buf: Buffer, fileName: string, direction: GreenInvoiceDirection,
): Promise<GreenInvoiceLoadResult | { error: string }> {
  const hash = createHash('sha256').update(buf).digest('hex')
  const [dup] = await sql<{ id: string }[]>`
    select id from import_batches where source = 'greeninvoice_import' and file_hash = ${hash} and deleted_at is null`

  let rows
  try { rows = rowsFromBuffer(buf).rows } catch (e) { return { error: `לא ניתן לקרוא את הקובץ: ${(e as Error).message}` } }
  const parsed = parseGreenInvoiceExport(rows, { direction, defaultYear: new Date().getUTCFullYear() })
  if ('error' in parsed) return { error: parsed.error }
  if (dup) {
    return { batchId: dup.id, existing: true, created: 0, duplicatesInFile: parsed.duplicates.length, alreadyInSystem: parsed.rows.length, matched: 0, partnerReview: 0, totals: parsed.totals, warnings: ['הקובץ כבר יובא — 0 שורות חדשות (§11.9)'] }
  }

  // ספקים קיימים + שמות שותפים מה-DB (לא רק מהרשימה המובנית).
  const [suppliers, partners] = await Promise.all([
    sql<{ id: string; name: string; aliases: string[] }[]>`select id, name, aliases from suppliers where deleted_at is null`,
    sql<{ id: string; name: string }[]>`select id, name from partners where deleted_at is null`,
  ])
  const partnerNames = ['די.אנד.די', 'די אנד די', 'd&d', ...partners.map((p) => p.name)]
  const supplierByName = new Map<string, string>()
  for (const s of suppliers) { supplierByName.set(normalizeName(s.name), s.id); for (const a of s.aliases) supplierByName.set(normalizeName(a), s.id) }

  const dates = parsed.rows.map((r) => r.docDate).sort()
  const from: string = dates[0]!
  const to: string = dates.at(-1)!
  const existing = await sql<{ source_ref: string }[]>`
    select source_ref from invoices where source = 'greeninvoice_import' and deleted_at is null
      and source_ref = any(${parsed.rows.map((r) => r.sourceRef)})`
  const known = new Set(existing.map((e) => e.source_ref))

  // מועמדי שידוך: תנועות בטווח התאריכים בכיוון המתאים.
  type TxRow = { id: string; date_cash: string; amount_gross: number; counterparty: string | null; description: string | null; invoice_id: string | null }
  const txs: TxRow[] = await sql<TxRow[]>`
    select id, to_char(date_cash, 'YYYY-MM-DD') as date_cash, amount_gross, counterparty, description, invoice_id
    from transactions where deleted_at is null and certainty = 'actual'
      and nature = ${direction === 'received' ? 'expense' : 'income'}
      and date_cash between ${from}::date - 45 and ${to}::date + 45`
  const pool = txs.map((t: TxRow) => ({ id: t.id, dateCash: t.date_cash, amountGross: t.amount_gross, counterparty: t.counterparty, description: t.description, invoiceId: t.invoice_id }))
  const used = new Set<string>()

  let created = 0, matched = 0, partnerReview = 0
  const batchId = await withActor(async (tx) => {
    const [batch] = await tx<{ id: string }[]>`
      insert into import_batches (source, file_name, file_hash, rows_total, rows_skipped, status, meta, imported_by)
      values ('greeninvoice_import', ${fileName}, ${hash}, ${parsed.rows.length}, ${parsed.skipped + parsed.duplicates.length}, 'applied',
              ${tx.json({ direction, totals: parsed.totals, warnings: parsed.warnings, duplicates: parsed.duplicates.length } as never)},
              current_setting('app.current_user_id', true)::uuid)
      returning id`

    for (const r of parsed.rows) {
      if (known.has(r.sourceRef)) continue
      const supplierId = supplierByName.get(r.supplierNormalized) ?? null
      const partnerRow = isPartnerSupplier(r.supplier, partnerNames)
      const partner = partnerRow ? partners.find((p) => normalizeName(r.supplier).includes(normalizeName(p.name))) ?? null : null

      // §4.3 — שידוך לתנועה: ברוטו ±1 ₪, ±30 יום, ספק מנורמל.
      const m = matchTarget({ amountGross: Math.abs(r.gross), date: r.docDate, supplierName: r.supplier }, pool.filter((c) => !used.has(c.id)), INVOICE_MATCH)
      const matchedTx = m.status === 'matched' ? m.best!.tx.id : null
      if (matchedTx) used.add(matchedTx)

      const sign = direction === 'received' ? -1 : 1
      const [inv] = await tx<{ id: string }[]>`
        insert into invoices (direction, doc_type, doc_number, date, counterparty, supplier_id, amount_net, vat_amount, amount_gross,
                              matched_tx_id, vat_period, reported, possible_duplicate, source, source_ref, needs_partner_review, partner_id)
        values (${direction}, ${r.docType}, ${r.docNumber}, ${r.docDate}, ${r.supplier}, ${supplierId},
                ${sign * Math.abs(r.net) * (r.gross < 0 ? -1 : 1)}, ${sign * Math.abs(r.vat) * (r.gross < 0 ? -1 : 1)}, ${sign * Math.abs(r.gross) * (r.gross < 0 ? -1 : 1)},
                ${matchedTx}, ${r.vatPeriod ?? r.docDate.slice(0, 7)}, ${r.reported}, ${r.possibleDuplicate},
                'greeninvoice_import', ${r.sourceRef}, ${partnerRow}, ${partner?.id ?? null})
        on conflict do nothing
        returning id`
      if (!inv) continue
      created++
      if (matchedTx) {
        matched++
        await tx`update transactions set invoice_status = 'has_invoice', invoice_id = ${inv.id} where id = ${matchedTx} and deleted_at is null`
      }
      if (partnerRow) {
        partnerReview++
        // §4.3 — חשבונית של ישות שותף אינה הוצאה; דורשת אישור לפני שתיחשב כמשיכה.
        await tx`
          insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
          values (${`לאשר: חשבונית מ-${r.supplier} ${Math.abs(r.gross)} ₪ — משיכה ולא הוצאה?`}, current_date + 3, 'high', true,
                  ${`partner_invoice:${inv.id}`}, 'SPEC §4.3 — ספק שהוא ישות של שותף (שאלה #15)')
          on conflict do nothing`
      }
    }
    await tx`update import_batches set rows_created = ${created}, rows_flagged = ${partnerReview} where id = ${batch!.id}`
    return batch!.id
  })

  return {
    batchId, created, duplicatesInFile: parsed.duplicates.length, alreadyInSystem: known.size, matched, partnerReview,
    totals: parsed.totals, warnings: parsed.warnings,
  }
}
