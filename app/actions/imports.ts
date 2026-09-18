'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { sql, withActor } from '@/lib/db'
import { rowsFromBuffer } from '@/lib/import/rows'
import { DEFAULT_COLUMN_MAPS, parseCardStatement, type ColumnMap } from '@/lib/import/credit-card'
import { DEFAULT_BANK_MAPS, parseBankStatement, type BankColumnMap } from '@/lib/import/bank'
import { BANK_MATCH, matchTarget } from '@/lib/match/invoices'
import { loadGreenInvoiceExport } from '@/lib/import/greeninvoice-load'
import { classifyBatch, normalizeDescription, proposeRule } from '@/lib/rules/classify'
import { isPeriodLocked, vatRateOn } from '@/lib/queries/common'
import { bankAccountId, existingSourceRefs, getBatch, listRules, unclassifiedCategoryId } from '@/lib/queries/imports'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const NATURES = ['expense', 'advance', 'income'] as const
const DIVISIONS = ['finance', 'realestate', 'shared', 'private'] as const

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** מיפויי עמודות: המובנים + מה שהוגדר בהגדרות (settings.import_column_maps). ההגדרה גוברת. */
async function columnMaps(): Promise<ColumnMap[]> {
  const rows = await sql<{ value: unknown }[]>`select value from settings where key = 'import_column_maps'`
  const custom = Array.isArray(rows[0]?.value) ? (rows[0]!.value as ColumnMap[]) : []
  const ids = new Set(custom.map((m) => m.id))
  return [...custom, ...DEFAULT_COLUMN_MAPS.filter((m) => !ids.has(m.id))]
}

/**
 * שלב 1 של מסך 11 — העלאת קובץ אשראי (SPEC §4.1).
 * מפענח, מזהה פורמט, מריץ כללים, ושומר *הצעות* ב-import_rows. שום דבר לא
 * נכנס ל-transactions כאן. אותו קובץ פעמיים → מחזיר את האצווה הקיימת (§11.9).
 */
export async function uploadCardStatement(fd: FormData): Promise<Result<{ id: string; existing?: boolean }>> {
  const file = fd.get('file')
  const accountId = str(fd, 'account_id')
  const billingDate = str(fd, 'billing_date') ?? undefined
  const formatId = str(fd, 'format_id') ?? undefined
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'לא נבחר קובץ' }
  if (!accountId) return { ok: false, error: 'יש לבחור את הכרטיס שהקובץ שייך לו' }
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'הקובץ גדול מ-10MB' }

  const [account] = await sql<{ id: string; name: string; default_division: string; type: string }[]>`
    select id, name, default_division, type from accounts where id = ${accountId} and deleted_at is null`
  if (!account || account.type !== 'credit_card') return { ok: false, error: 'החשבון שנבחר אינו כרטיס אשראי' }

  const buf = Buffer.from(await file.arrayBuffer())
  const hash = createHash('sha256').update(buf).digest('hex')
  const [dup] = await sql<{ id: string }[]>`
    select id from import_batches where source = 'card_import' and file_hash = ${hash} and deleted_at is null`
  if (dup) return { ok: true, id: dup.id, existing: true }

  let rows
  try { rows = rowsFromBuffer(buf).rows } catch (e) { return { ok: false, error: `לא ניתן לקרוא את הקובץ: ${(e as Error).message}` } }
  const parsed = parseCardStatement(rows, { billingDate, formatId, maps: await columnMaps(), defaultYear: new Date().getUTCFullYear() })
  if ('error' in parsed) return { ok: false, error: parsed.error }

  const [rules, existing] = await Promise.all([
    listRules(),
    existingSourceRefs(accountId, parsed.children.map((c) => c.sourceRef)),
  ])
  const classified = classifyBatch(
    parsed.children.map((c) => ({ description: c.merchant, accountId, amount: c.amount })),
    rules,
  )
  const dates = parsed.children.map((c) => c.date).sort()
  const meta = {
    formatId: parsed.formatId, formatLabel: parsed.formatLabel, billingDate: parsed.billingDate,
    parentAmount: parsed.parentAmount, warnings: parsed.warnings, skipped: parsed.skipped,
    dateFrom: dates[0]!, dateTo: dates.at(-1)!,
  }

  try {
    const id = await withActor(async (tx) => {
      const [batch] = await tx<{ id: string }[]>`
        insert into import_batches (source, file_name, file_hash, rows_total, rows_skipped, rows_flagged, status, account_id, meta, imported_by)
        values ('card_import', ${file.name}, ${hash}, ${parsed.children.length}, ${existing.size + parsed.skipped},
                ${classified.results.filter((r) => !r.suggestion && !existing.has(parsed.children[classified.results.indexOf(r)]!.sourceRef)).length},
                'review', ${accountId}, ${tx.json(meta)}, current_setting('app.current_user_id', true)::uuid)
        returning id`
      for (const [i, child] of parsed.children.entries()) {
        const s = classified.results[i]!.suggestion
        const isDup = existing.has(child.sourceRef)
        // זיכוי (סכום חיובי) — החזר על הוצאה. ה-DB אוסר הוצאה חיובית, אז נכנס כהכנסה עם אותה קטגוריה (שאלה #25).
        const nature = child.amount > 0 ? 'income' : (s?.nature ?? 'expense')
        const division = nature === 'advance' ? 'finance' : (s?.division ?? account.default_division)
        const txClass = s?.txClass ?? 'business'
        await tx`
          insert into import_rows
            (batch_id, row_index, source_ref, date, merchant, amount, amount_original, reference, category_hint, notes, card_last4,
             rule_id, matched_pattern, nature, division, category_id, tx_class, invoice_status, deductible, review_status, decision)
          values
            (${batch!.id}, ${child.rowIndex}, ${child.sourceRef}, ${child.date}, ${child.merchant}, ${child.amount},
             ${child.amountOriginal ?? null}, ${child.reference ?? null}, ${child.categoryHint ?? null}, ${child.notes ?? null}, ${child.cardLast4 ?? null},
             ${s?.ruleId ?? null}, ${s?.matchedPattern ?? null}, ${nature}, ${division}, ${s?.categoryId ?? null},
             ${txClass}, ${s?.invoiceStatus ?? 'unknown'},
             ${nature === 'expense' ? (s?.deductible ?? txClass === 'business') : null},
             ${s ? 'ok' : 'unknown_expense'}, ${isDup ? 'duplicate' : 'pending'})`
      }
      return batch!.id
    })
    revalidatePath('/import')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** עריכה בשורה במסך האישור. שינוי סיווג ידני מסמן edited=true → "להפוך לכלל?" (§4.4). */
export async function setImportRow(
  id: string,
  patch: { nature?: string; division?: string; category_id?: string | null; tx_class?: string; invoice_status?: string; deductible?: boolean; review_status?: string; decision?: string },
): Promise<Result> {
  if (patch.nature && !NATURES.includes(patch.nature as never)) return { ok: false, error: 'סוג לא חוקי' }
  if (patch.division && !DIVISIONS.includes(patch.division as never)) return { ok: false, error: 'פעילות לא חוקית' }
  const classification = ['nature', 'division', 'category_id', 'tx_class', 'invoice_status', 'deductible'].some((k) => k in patch)
  const p: Record<string, unknown> = { ...patch }
  if (patch.nature === 'advance') { p.division = 'finance'; p.deductible = null }
  if (patch.nature === 'income') p.deductible = null
  if (classification) { p.edited = true; if (patch.review_status === undefined && (patch.category_id || patch.nature === 'advance')) p.review_status = 'ok' }
  try {
    await withActor(async (tx) => {
      const [b] = await tx<{ status: string }[]>`
        select b.status from import_rows r join import_batches b on b.id = r.batch_id where r.id = ${id}`
      if (b?.status !== 'review') throw new Error('האצווה כבר הוחלה או בוטלה')
      await tx`update import_rows set ${tx(p)} where id = ${id} and deleted_at is null`
    })
    revalidatePath('/import')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** "אשר את כל האוטומטיים (N)" — UIUX §5.5 שלב 2. */
export async function approveRows(batchId: string, which: 'auto' | 'all' | string[]): Promise<Result<{ approved: number }>> {
  try {
    const n = await withActor(async (tx) => {
      const res = which === 'auto'
        ? await tx`update import_rows set decision = 'approved' where batch_id = ${batchId} and decision = 'pending' and rule_id is not null and deleted_at is null`
        : which === 'all'
          ? await tx`update import_rows set decision = 'approved' where batch_id = ${batchId} and decision = 'pending' and (nature <> 'expense' or category_id is not null) and deleted_at is null`
          : await tx`update import_rows set decision = 'approved' where batch_id = ${batchId} and id = any(${which}) and decision in ('pending', 'skipped') and (nature <> 'expense' or category_id is not null) and deleted_at is null`
      return res.count
    })
    revalidatePath('/import')
    return { ok: true, approved: n }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * שלב 3 של מסך 11 — "החל ייבוא": האב (החיוב בבנק) + הבנות בטרנזקציה אחת.
 * SPEC §4.1: "כל קובץ → תנועת-אב אחת (החיוב בבנק, date_cash=יום החיוב) + בנות."
 * שורה בלי קטגוריה נכנסת עם review_status=unknown_expense + משימה (rule_key ייחודי, הנחיה 18).
 */
export async function applyBatch(batchId: string): Promise<Result<{ created: number; skipped: number; flagged: number; parentTxId: string }>> {
  const data = await getBatch(batchId)
  if (!data) return { ok: false, error: 'אצווה לא נמצאה' }
  const { batch, rows } = data
  if (batch.status !== 'review') return { ok: false, error: 'האצווה כבר הוחלה או בוטלה' }
  if (!batch.account_id || !batch.meta) return { ok: false, error: 'אצווה ללא כרטיס או ללא פענוח' }
  const meta = batch.meta
  const bankId = await bankAccountId()
  if (!bankId) return { ok: false, error: 'אין חשבון בנק פעיל לרישום החיוב' }
  const unclassified = await unclassifiedCategoryId()
  if (!unclassified) return { ok: false, error: 'חסרה קטגוריית "לא מסווג" (db/seed/001_categories.sql)' }

  const toWrite = rows.filter((r) => r.decision === 'pending' || r.decision === 'approved')
  if (!toWrite.length) return { ok: false, error: 'אין שורות לייבוא — כולן דולגו או כפולות' }

  const month = meta.billingDate.slice(0, 7)
  const divisions = new Set(toWrite.map((r) => r.division === 'realestate' ? 'realestate' : 'finance'))
  for (const d of divisions) {
    if (await isPeriodLocked(month, d as 'finance')) return { ok: false, error: `התקופה ${month.slice(5)}/${month.slice(0, 4)} נעולה לפעילות — לא ניתן לייבא אליה (SPEC §1.6)` }
  }
  const vatRate = await vatRateOn(meta.billingDate)
  const [account] = await sql<{ name: string; default_division: string }[]>`select name, default_division from accounts where id = ${batch.account_id}`
  const parentDivision = account!.default_division === 'realestate' ? 'realestate' : 'finance'
  const parentAmount = Math.round(toWrite.reduce((a, r) => a + r.amount, 0) * 100) / 100

  try {
    const out = await withActor(async (tx) => {
      const [parent] = await tx<{ id: string }[]>`
        insert into transactions
          (date_cash, account_id, amount_net, vat_mode, vat_rate, nature, division, counterparty, description, invoice_status, source, source_ref)
        values
          (${meta.billingDate}, ${bankId}, ${parentAmount}, 'exempt', ${vatRate}, 'transfer', ${parentDivision},
           ${account!.name}, ${`חיוב כרטיס ${account!.name} — ${meta.formatLabel} ${meta.billingDate}`}, 'no_invoice_needed',
           'card_import', ${`card:${meta.formatId}:parent:${batch.file_hash}`})
        returning id`
      let flagged = 0
      const hits = new Map<string, number>()
      for (const r of toWrite) {
        const missingCategory = r.nature === 'expense' && !r.category_id
        const reviewStatus = missingCategory ? 'unknown_expense' : r.review_status
        const categoryId = r.nature === 'expense' ? (r.category_id ?? unclassified) : r.category_id
        // הוצאה עסקית בכרטיס = סכום כולל מע"מ; מקדמה/פרטי — בלי פירוק מע"מ.
        const vatMode = r.nature === 'advance' || r.division === 'private' || r.tx_class === 'private' ? 'exempt' : 'incl'
        const [child] = await tx<{ id: string }[]>`
          insert into transactions
            (date_cash, date_doc, account_id, amount_net, vat_mode, vat_rate, nature, division, category_id, tx_class, deductible,
             counterparty, description, invoice_status, review_status, review_note, parent_id, source, source_ref)
          values
            (${meta.billingDate}, ${r.date}, ${batch.account_id}, ${r.amount}, ${vatMode}, ${vatRate}, ${r.nature}, ${r.division},
             ${categoryId}, ${r.tx_class}, ${r.nature === 'expense' ? Boolean(r.deductible) : null},
             ${r.merchant}, ${[r.merchant, r.notes, r.category_hint].filter(Boolean).join(' · ')}, ${r.invoice_status}, ${reviewStatus},
             ${r.rule_id ? `סווג לפי כלל: ${r.matched_pattern}` : null}, ${parent!.id}, 'card_import', ${r.source_ref})
          returning id`
        await tx`update import_rows set applied_tx_id = ${child!.id}, review_status = ${reviewStatus}, decision = 'approved', category_id = ${categoryId} where id = ${r.id}`
        if (r.rule_id) hits.set(r.rule_id, (hits.get(r.rule_id) ?? 0) + 1)
        // SPEC §4.1 — "שורה שאינה מזוהה → כפתור 'לשאול את ניסים / אביב' → משימה." ADDENDUM 18 — rule_key ייחודי.
        const ask = reviewStatus === 'unknown_expense' ? 'לסווג' : reviewStatus === 'ask_nissim' ? 'לשאול את ניסים' : reviewStatus === 'ask_aviv' ? 'לשאול את אביב' : reviewStatus === 'ask_yoni' ? 'לשאול את יוני' : null
        if (ask) {
          flagged++
          await tx`
            insert into tasks (title, due_date, priority, auto_generated, auto_key, tx_id, notes)
            values (${`${ask}: ${r.merchant} ${r.amount} ₪ (${r.date})`}, ${meta.billingDate}::date + 7, 'normal', true,
                    ${`${reviewStatus}:${child!.id}`}, ${child!.id}, ${`ייבוא ${meta.formatLabel} · ${batch.file_name}`})
            on conflict do nothing`
        }
      }
      for (const [ruleId, n] of hits) await tx`update rules set hit_count = hit_count + ${n} where id = ${ruleId}`
      const skipped = rows.length - toWrite.length + meta.skipped
      await tx`
        update import_batches
        set status = 'applied', applied_at = now(), rows_created = ${toWrite.length + 1}, rows_skipped = ${skipped}, rows_flagged = ${flagged},
            meta = ${tx.json({ ...meta, parentTxId: parent!.id, parentAmountApplied: parentAmount })}
        where id = ${batchId}`
      return { created: toWrite.length, skipped, flagged, parentTxId: parent!.id }
    })
    revalidatePath('/import'); revalidatePath('/transactions'); revalidatePath('/pnl')
    return { ok: true, ...out }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** ביטול אצווה = soft delete (§11.4), כדי שאותו קובץ יוכל לעלות שוב. */
export async function cancelBatch(batchId: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      const r = await tx`update import_batches set status = 'cancelled', deleted_at = now() where id = ${batchId} and status = 'review' and deleted_at is null`
      if (!r.count) throw new Error('אפשר לבטל רק אצווה שממתינה לאישור')
      await tx`update import_rows set deleted_at = now() where batch_id = ${batchId} and deleted_at is null`
    })
    revalidatePath('/import')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** כרטיס אשראי חדש — SPEC §2.1 accounts (יום חיוב 2/10/15). הגדרה, לא נתון. */
export async function createCardAccount(fd: FormData): Promise<Result<{ id: string }>> {
  const name = str(fd, 'name')
  const entityId = str(fd, 'entity_id')
  const billingDay = Number(str(fd, 'billing_day') ?? '')
  const division = str(fd, 'default_division') ?? 'finance'
  if (!name || !entityId) return { ok: false, error: 'שם וישות הם חובה' }
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) return { ok: false, error: 'יום חיוב בין 1 ל-31' }
  if (!DIVISIONS.includes(division as never)) return { ok: false, error: 'פעילות לא חוקית' }
  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into accounts (entity_id, type, name, billing_day, default_division)
        values (${entityId}, 'credit_card', ${name}, ${billingDay}, ${division}) returning id`
      return row!.id
    })
    revalidatePath('/import')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * SPEC §4.4 — "כל סיווג ידני מציע 'להפוך לכלל?'". יוצר כלל מתוך שורת ייבוא או תנועה.
 * אותה תבנית + אותו חשבון → עדכון הכלל הקיים, לא כפילות (findConflicts).
 */
export async function createRuleFrom(
  source: { importRowId: string } | { txId: string },
  opts: { scopeToAccount?: boolean; pattern?: string } = {},
): Promise<Result<{ id: string; pattern: string }>> {
  try {
    const out = await withActor(async (tx) => {
      const [r] = 'importRowId' in source
        ? await tx<{ description: string; account_id: string; category_id: string | null; division: string; nature: string; tx_class: string; invoice_status: string; deductible: boolean | null }[]>`
            select r.merchant as description, b.account_id, r.category_id, r.division, r.nature, r.tx_class, r.invoice_status, r.deductible
            from import_rows r join import_batches b on b.id = r.batch_id where r.id = ${source.importRowId}`
        : await tx<{ description: string; account_id: string; category_id: string | null; division: string; nature: string; tx_class: string; invoice_status: string; deductible: boolean | null }[]>`
            select coalesce(counterparty, description) as description, account_id, category_id, division, nature, tx_class, invoice_status, deductible
            from transactions where id = ${source.txId} and deleted_at is null`
      if (!r) throw new Error('לא נמצא מקור לכלל')
      if (r.nature === 'expense' && !r.category_id) throw new Error('כלל להוצאה חייב קטגוריה — סווגו קודם')
      const proposed = proposeRule(
        { description: r.description, accountId: r.account_id },
        { categoryId: r.category_id ?? undefined, division: r.division, nature: r.nature, txClass: r.tx_class, invoiceStatus: r.invoice_status, deductible: r.deductible ?? undefined },
        { scopeToAccount: opts.scopeToAccount },
      )
      const pattern = opts.pattern?.trim() || proposed.pattern
      if (pattern.length < 3) throw new Error('תבנית קצרה מדי')
      const scopeAccount: string | null = proposed.accountId ?? null
      const existing: { id: string; pattern: string }[] = await tx<{ id: string; pattern: string }[]>`
        select id, pattern from rules where deleted_at is null and active and account_id is not distinct from ${scopeAccount}`
      const same = existing.find((e: { pattern: string }) => normalizeDescription(e.pattern) === normalizeDescription(pattern))
      const values = {
        pattern, is_regex: false, account_id: proposed.accountId, set_category_id: proposed.setCategoryId, set_division: proposed.setDivision,
        set_nature: proposed.setNature, set_tx_class: proposed.setTxClass, set_invoice_status: proposed.setInvoiceStatus,
        set_deductible: proposed.setDeductible, priority: proposed.priority,
      }
      if (same) { await tx`update rules set ${tx(values)} where id = ${same.id}`; return { id: same.id, pattern } }
      const [row] = await tx<{ id: string }[]>`insert into rules ${tx(values)} returning id`
      return { id: row!.id, pattern }
    })
    revalidatePath('/import'); revalidatePath('/transactions')
    return { ok: true, ...out }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function deactivateRule(id: string): Promise<Result> {
  try {
    await withActor(async (tx) => { await tx`update rules set active = false where id = ${id}` })
    revalidatePath('/import')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}


/** מיפויי עמודות לבנקים: המובנים + settings.bank_column_maps. */
async function bankMaps(): Promise<BankColumnMap[]> {
  const rows = await sql<{ value: unknown }[]>`select value from settings where key = 'bank_column_maps'`
  const custom = Array.isArray(rows[0]?.value) ? (rows[0]!.value as BankColumnMap[]) : []
  const ids = new Set(custom.map((m) => m.id))
  return [...custom, ...DEFAULT_BANK_MAPS.filter((m) => !ids.has(m.id))]
}

/**
 * ייבוא דף בנק — SPEC §4.2.
 * מפענח, משדך כל שורה לתנועה קיימת (±1 ₪, ±3 ימים, אותו חשבון), ושומר לאישור.
 * יתרת הסגירה נבדקת מול המחושבת; פער מוצג ולא נבלע.
 */
export async function uploadBankStatement(fd: FormData): Promise<Result<{ id: string; existing?: boolean }>> {
  const file = fd.get('file')
  const accountId = str(fd, 'account_id')
  const formatId = str(fd, 'format_id') ?? undefined
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'לא נבחר קובץ' }
  if (!accountId) return { ok: false, error: 'יש לבחור את חשבון הבנק' }
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'הקובץ גדול מ-10MB' }

  const [account] = await sql<{ id: string; name: string; type: string; default_division: string }[]>`
    select id, name, type, default_division from accounts where id = ${accountId} and deleted_at is null`
  if (!account || account.type !== 'bank') return { ok: false, error: 'החשבון שנבחר אינו חשבון בנק' }

  const buf = Buffer.from(await file.arrayBuffer())
  const hash = createHash('sha256').update(buf).digest('hex')
  const [dup] = await sql<{ id: string }[]>`select id from import_batches where source = 'bank_import' and file_hash = ${hash} and deleted_at is null`
  if (dup) return { ok: true, id: dup.id, existing: true }

  let rows
  try { rows = rowsFromBuffer(buf).rows } catch (e) { return { ok: false, error: `לא ניתן לקרוא את הקובץ: ${(e as Error).message}` } }
  const parsed = parseBankStatement(rows, { formatId, maps: await bankMaps(), defaultYear: new Date().getUTCFullYear() })
  if ('error' in parsed) return { ok: false, error: parsed.error }

  // §4.2 — שידוך לתנועות קיימות באותו חשבון בטווח התאריכים.
  const existingTx = await sql<{ id: string; date_cash: string; amount_gross: number; counterparty: string | null; description: string | null }[]>`
    select id, to_char(date_cash, 'YYYY-MM-DD') as date_cash, amount_gross, counterparty, description
    from transactions where account_id = ${accountId} and deleted_at is null and parent_id is null
      and date_cash between ${parsed.dateFrom}::date - 5 and ${parsed.dateTo}::date + 5`
  const alreadyImported = await existingSourceRefs(accountId, parsed.rows.map((r) => r.sourceRef))
  const candidatesPool = existingTx.map((t) => ({ id: t.id, dateCash: t.date_cash, amountGross: t.amount_gross, counterparty: t.counterparty, description: t.description, accountId }))
  const usedTx = new Set<string>()

  const meta = {
    formatId: parsed.formatId, formatLabel: parsed.formatLabel, billingDate: parsed.dateTo,
    parentAmount: Math.round(parsed.rows.reduce((a, r) => a + r.amount, 0) * 100) / 100,
    warnings: parsed.warnings, skipped: parsed.skipped, dateFrom: parsed.dateFrom, dateTo: parsed.dateTo,
    openingBalance: parsed.openingBalance, closingBalance: parsed.closingBalance,
    computedClosing: parsed.computedClosing, balanceMatches: parsed.balanceMatches, balanceGap: parsed.balanceGap,
    firstBalanceBreak: parsed.firstBalanceBreak,
  }

  try {
    const id = await withActor(async (tx) => {
      const [batch] = await tx<{ id: string }[]>`
        insert into import_batches (source, file_name, file_hash, rows_total, rows_skipped, status, account_id, meta, imported_by)
        values ('bank_import', ${file.name}, ${hash}, ${parsed.rows.length}, ${parsed.skipped + alreadyImported.size}, 'review', ${accountId},
                ${tx.json(meta as never)}, current_setting('app.current_user_id', true)::uuid)
        returning id`
      for (const row of parsed.rows) {
        const isDup = alreadyImported.has(row.sourceRef)
        const m = matchTarget({ amountGross: row.amount, date: row.date, accountId }, candidatesPool.filter((c) => !usedTx.has(c.id)), BANK_MATCH)
        if (m.status === 'matched' && m.best) usedTx.add(m.best.tx.id)
        await tx`
          insert into import_rows
            (batch_id, row_index, source_ref, date, merchant, amount, reference, notes, balance,
             nature, division, tx_class, invoice_status, review_status, decision, match_status, matched_tx_id, match_candidates)
          values
            (${batch!.id}, ${row.rowIndex}, ${row.sourceRef}, ${row.date}, ${row.description}, ${row.amount}, ${row.reference ?? null},
             ${row.bookedDate !== row.date ? `תאריך פעולה ${row.bookedDate}` : null}, ${row.balance ?? null},
             ${row.amount >= 0 ? 'income' : 'expense'}, ${account.default_division}, 'business', 'unknown',
             ${m.status === 'matched' ? 'ok' : 'unknown_expense'},
             ${isDup ? 'duplicate' : m.status === 'matched' ? 'approved' : 'pending'},
             ${m.status}, ${m.status === 'matched' ? m.best!.tx.id : null},
             ${tx.json(m.candidates.slice(0, 5).map((c) => ({ txId: c.tx.id, date: c.tx.dateCash, amount: c.tx.amountGross, label: c.tx.counterparty ?? c.tx.description, score: c.score, reasons: c.reasons })) as never)})`
      }
      return batch!.id
    })
    revalidatePath('/import')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * החלת דף בנק — SPEC §4.2: שורה ששודכה מסמנת את התנועה כמאומתת מול הבנק;
 * שורה ללא התאמה יוצרת תנועה חדשה עם review_status=unknown_expense.
 * אין כאן תנועת-אב: דף הבנק **הוא** החשבון, לא חיוב מרוכז.
 */
export async function applyBankBatch(batchId: string): Promise<Result<{ matched: number; created: number; skipped: number }>> {
  const data = await getBatch(batchId)
  if (!data) return { ok: false, error: 'אצווה לא נמצאה' }
  const { batch, rows } = data
  if (batch.source !== 'bank_import') return { ok: false, error: 'האצווה אינה דף בנק' }
  if (batch.status !== 'review') return { ok: false, error: 'האצווה כבר הוחלה או בוטלה' }
  if (!batch.account_id) return { ok: false, error: 'אצווה ללא חשבון' }
  const unclassified = await unclassifiedCategoryId()
  if (!unclassified) return { ok: false, error: 'חסרה קטגוריית "לא מסווג"' }

  const toWrite = rows.filter((r) => r.decision === 'pending' || r.decision === 'approved')
  if (!toWrite.length) return { ok: false, error: 'אין שורות לייבוא' }

  // §11.8 — תקופה נעולה נדחית לפני שמנסים לכתוב.
  const months = new Set(toWrite.map((r) => r.date.slice(0, 7)))
  for (const m of months) {
    if (await isPeriodLocked(m, 'finance')) return { ok: false, error: `התקופה ${m.slice(5)}/${m.slice(0, 4)} נעולה — לא ניתן לייבא אליה (SPEC §1.6)` }
  }
  const vatRate = await vatRateOn(batch.meta?.dateTo ?? new Date().toISOString().slice(0, 10))

  try {
    const out = await withActor(async (tx) => {
      let matched = 0, created = 0
      for (const r of rows.filter((x) => toWrite.includes(x))) {
        if (r.matched_tx_id) {
          // התנועה כבר קיימת במערכת — מסמנים שהיא אומתה מול הבנק ושומרים את האסמכתא.
          await tx`
            update transactions set source_ref = coalesce(source_ref, ${r.source_ref}), review_note = coalesce(review_note, 'אומת מול דף הבנק')
            where id = ${r.matched_tx_id} and deleted_at is null`
          await tx`update import_rows set applied_tx_id = ${r.matched_tx_id}, decision = 'approved' where id = ${r.id}`
          matched++
          continue
        }
        const isExpense = r.amount < 0
        const [createdTx] = await tx<{ id: string }[]>`
          insert into transactions
            (date_cash, account_id, amount_net, vat_mode, vat_rate, nature, division, category_id, tx_class, deductible,
             counterparty, description, invoice_status, review_status, source, source_ref)
          values
            (${r.date}, ${batch.account_id}, ${r.amount}, 'exempt', ${vatRate}, ${isExpense ? 'expense' : 'income'}, ${r.division},
             ${isExpense ? (r.category_id ?? unclassified) : r.category_id}, ${r.tx_class}, ${isExpense ? Boolean(r.deductible) : null},
             ${r.merchant}, ${r.merchant}, 'unknown', 'unknown_expense', 'bank_import', ${r.source_ref})
          returning id`
        // הקטגוריה נשמרת גם בשורת הייבוא — אחרת האילוץ "הוצאה מאושרת חייבת קטגוריה" נופל.
        await tx`
          update import_rows
          set applied_tx_id = ${createdTx!.id}, decision = 'approved', review_status = 'unknown_expense',
              category_id = ${isExpense ? (r.category_id ?? unclassified) : r.category_id}
          where id = ${r.id}`
        await tx`
          insert into tasks (title, due_date, priority, auto_generated, auto_key, tx_id, notes)
          values (${`לסווג תנועת בנק: ${r.merchant} ${r.amount} ₪ (${r.date})`}, current_date + 7, 'normal', true,
                  ${`unknown_expense:${createdTx!.id}`}, ${createdTx!.id}, ${`דף בנק · ${batch.file_name}`})
          on conflict do nothing`
        created++
      }
      const skipped = rows.length - toWrite.length
      await tx`
        update import_batches set status = 'applied', applied_at = now(), rows_created = ${created}, rows_skipped = ${skipped}, rows_flagged = ${created}
        where id = ${batchId}`
      return { matched, created, skipped }
    })
    revalidatePath('/import'); revalidatePath('/transactions'); revalidatePath('/cashflow')
    return { ok: true, ...out }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** שידוך ידני במסך האישור של דף בנק. */
export async function setBankMatch(rowId: string, txId: string | null): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update import_rows set matched_tx_id = ${txId}, match_status = ${txId ? 'matched' : 'none'},
               review_status = ${txId ? 'ok' : 'unknown_expense'}, decision = ${txId ? 'approved' : 'pending'}, edited = true
               where id = ${rowId} and deleted_at is null`
    })
    revalidatePath('/import')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}


/** ייבוא ייצוא חשבונית ירוקה — SPEC §4.3. הוצאות או מסמכים שהוצאנו. */
export async function uploadGreenInvoice(fd: FormData): Promise<Result<{ created: number; matched: number; duplicates: number; already: number; partnerReview: number; existing?: boolean }>> {
  const file = fd.get('file')
  const direction = str(fd, 'direction') === 'issued' ? 'issued' : 'received'
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'לא נבחר קובץ' }
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: 'הקובץ גדול מ-20MB' }
  try {
    const r = await loadGreenInvoiceExport(Buffer.from(await file.arrayBuffer()), file.name, direction)
    if ('error' in r) return { ok: false, error: r.error }
    revalidatePath('/import'); revalidatePath('/gaps'); revalidatePath('/vat'); revalidatePath('/transactions')
    return { ok: true, created: r.created, matched: r.matched, duplicates: r.duplicatesInFile, already: r.alreadyInSystem, partnerReview: r.partnerReview, existing: r.existing }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
