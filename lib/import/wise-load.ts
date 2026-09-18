/**
 * כתיבת ייצוא WISE ל-DB — SPEC §4.5.
 *
 * שני כללים שהאפיון מדגיש, ושניהם נאכפים כאן:
 *   • **ייבוא idempotent** — ריצה חוזרת מעדכנת סטטוסים ולא מכפילה (`wise_ref`).
 *   • **שדות שנערכו אצלנו לעולם לא נדרסים** — שכ"ט, חודש התיק ולוח התשלומים
 *     נשארים שלנו. מ-WISE מתעדכנים רק שם, טלפון, אימייל, שלב והגשות.
 */
import { createHash } from 'node:crypto'
import { sql, withActor } from '@/lib/db'
import { rowsFromBuffer } from './rows.js'
import { dedupeLeads, parseWiseExport, type WiseExportKind, type WiseLead } from './wise.js'

export interface WiseLoadResult {
  kind: WiseExportKind
  batchId: string
  existing: boolean
  leadsCreated: number
  leadsUpdated: number
  dealsLinked: number
  dealsCreated: number
  submissionsCreated: number
  submissionsUpdated: number
  sourcesCreated: number
  skipped: number
  warnings: string[]
}

/** §4.5 — הגשה מזינה את ההסתברות: הגשה → submitted, אישור → approved_in_principle. */
const STAGE_FOR_SUBMISSION = 'submitted'
const STAGE_FOR_APPROVAL = 'approved_in_principle'
/** רק משלב זה ומטה מותר לקדם אוטומטית — תיק שכבר התקדם ידנית לא נסוג. */
const AUTO_PROMOTABLE = ['prospect', 'signed_collecting_docs', 'submitted']

export async function loadWiseExport(
  buffer: Buffer,
  fileName: string,
  opts: { formProduct?: string } = {},
): Promise<WiseLoadResult | { error: string }> {
  let rows
  try { rows = rowsFromBuffer(buffer).rows } catch (e) { return { error: `לא ניתן לקרוא את הקובץ: ${(e as Error).message}` } }

  const parsed = parseWiseExport(rows, { formProduct: opts.formProduct })
  if ('error' in parsed) return parsed

  const hash = createHash('sha256').update(buffer).digest('hex')
  const [dup] = await sql<{ id: string }[]>`
    select id from import_batches where source = 'wise_import' and file_hash = ${hash} and deleted_at is null`
  if (dup) {
    return {
      kind: parsed.kind, batchId: dup.id, existing: true,
      leadsCreated: 0, leadsUpdated: 0, dealsLinked: 0, dealsCreated: 0,
      submissionsCreated: 0, submissionsUpdated: 0, sourcesCreated: 0,
      skipped: 0, warnings: parsed.warnings,
    }
  }

  const leads = dedupeLeads(parsed.leads)
  const out = await withActor(async (tx) => {
    const [batch] = await tx<{ id: string }[]>`
      insert into import_batches (source, file_name, file_hash, rows_total, rows_skipped, status, meta, imported_by, applied_at)
      values ('wise_import', ${fileName}, ${hash},
              ${leads.length + parsed.customers.length + parsed.submissions.length}, ${parsed.skipped}, 'applied',
              ${tx.json({ kind: parsed.kind, warnings: parsed.warnings, unknownStatuses: parsed.unknownStatuses } as never)},
              current_setting('app.current_user_id', true)::uuid, now())
      returning id`
    const batchId = batch!.id

    let leadsCreated = 0, leadsUpdated = 0, dealsLinked = 0, dealsCreated = 0
    let submissionsCreated = 0, submissionsUpdated = 0, sourcesCreated = 0

    // ── מקורות: נוצרים לפי הצורך. זו תצורה, לא מספרים. ─────────────────────
    const sourceIds = new Map<string, string>()
    const sourceNames = [...new Set(leads.map((l) => l.sourceName))]
    for (const name of sourceNames) {
      const [existing] = await tx<{ id: string }[]>`
        select id from lead_sources where lower(name) = lower(${name}) and deleted_at is null`
      if (existing) { sourceIds.set(name, existing.id); continue }
      const [created] = await tx<{ id: string }[]>`
        insert into lead_sources (name, cost_model) values (${name}, 'per_lead') returning id`
      sourceIds.set(name, created!.id)
      sourcesCreated++
    }

    // ── מתעניינים → leads ──────────────────────────────────────────────────
    for (const l of leads) {
      const sourceId = sourceIds.get(l.sourceName)!
      // האינדקס הייחודי על wise_ref לא מתעלם משורות מחוקות רכות — ולכן מחפשים
      // גם אותן ומחיים אותן, במקום להתנגש.
      const [existing] = await tx<{ id: string; stage: string }[]>`
        select id, stage::text from leads where wise_ref = ${l.wiseRef}`
      if (existing) {
        // הסטטוס ב-WISE הוא מקור האמת התפעולי — הוא כן מתעדכן.
        await tx`
          update leads
          set stage = ${l.stage}::lead_stage, name = coalesce(${l.name}, name), phone = coalesce(${l.phone}, phone),
              email = coalesce(${l.email}, email), notes = coalesce(${l.notes}, notes), source_id = ${sourceId},
              deleted_at = null
          where id = ${existing.id}`
        leadsUpdated++
      } else {
        await tx`
          insert into leads (date, source_id, product, stage, name, phone, email, wise_ref, notes)
          values (${l.date}, ${sourceId}, ${l.product}, ${l.stage}::lead_stage, ${l.name}, ${l.phone}, ${l.email}, ${l.wiseRef}, ${l.notes})`
        leadsCreated++
      }

      // חיבור לליד שכבר יש לו תיק — לפי טלפון. התיק עצמו לא נגוע.
      if (l.phone) {
        const [deal] = await tx<{ id: string }[]>`
          select id from deals where deleted_at is null
            and regexp_replace(coalesce(client_phone, ''), '\\D', '', 'g') = regexp_replace(${l.phone}, '\\D', '', 'g')
          limit 1`
        if (deal) {
          const res = await tx`update leads set deal_id = ${deal.id} where wise_ref = ${l.wiseRef} and deal_id is null`
          if (res.count) dealsLinked++
        }
      }
    }

    // ── לקוחות → deals (יצירה/עדכון, בלי לדרוס כסף) ────────────────────────
    for (const c of parsed.customers) {
      const [existing] = await tx<{ id: string }[]>`
        select id from deals where (
          wise_ref = ${c.wiseRef}
          or (${c.phone}::text is not null and regexp_replace(coalesce(client_phone, ''), '\\D', '', 'g') = regexp_replace(coalesce(${c.phone}, ''), '\\D', '', 'g'))
          or lower(client_name) = lower(${c.name}))
        limit 1`
      if (existing) {
        // §4.5 — שכ"ט, חודש ולוח התשלומים לא נדרסים. רק פרטי קשר ואסמכתא.
        await tx`
          update deals
          set wise_ref = coalesce(wise_ref, ${c.wiseRef}),
              client_phone = coalesce(client_phone, ${c.phone}),
              client_email = coalesce(client_email, ${c.email}),
              last_activity_at = greatest(coalesce(last_activity_at, now()), now()), deleted_at = null
          where id = ${existing.id}`
        dealsLinked++
      } else {
        await tx`
          insert into deals (client_name, client_phone, client_email, division, product, stage, fee_agreed_net, wise_ref, notes)
          values (${c.name}, ${c.phone}, ${c.email}, 'finance', 'mortgage', 'prospect', 0, ${c.wiseRef},
                  ${'נוצר מייבוא WISE — שכ"ט והתשלומים מוזנים אצלנו'})`
        dealsCreated++
      }
    }

    // ── הגשות → deal_submissions, ומזינות את השלב (§4.5 + §2.3) ────────────
    for (const s of parsed.submissions) {
      const [deal] = await tx<{ id: string; stage: string }[]>`
        select id, stage from deals where deleted_at is null and lower(client_name) = lower(${s.clientName}) limit 1`
      if (!deal) continue

      const [existing] = await tx<{ id: string }[]>`
        select id from deal_submissions where wise_ref = ${s.wiseRef}`
      if (existing) {
        await tx`
          update deal_submissions
          set status = coalesce(${s.status}, status), approved_at = coalesce(${s.approvedAt}, approved_at),
              branch = coalesce(${s.branch}, branch), deleted_at = null
          where id = ${existing.id}`
        submissionsUpdated++
      } else {
        await tx`
          insert into deal_submissions (deal_id, bank, branch, submitted_at, status, approved_at, wise_ref)
          values (${deal.id}, ${s.bank}, ${s.branch}, ${s.submittedAt}, ${s.status}, ${s.approvedAt}, ${s.wiseRef})`
        submissionsCreated++
      }

      const target = s.approvedAt ? STAGE_FOR_APPROVAL : STAGE_FOR_SUBMISSION
      if (AUTO_PROMOTABLE.includes(deal.stage) && deal.stage !== target) {
        await tx`
          update deals set stage = ${target}, last_activity_at = now()
          where id = ${deal.id} and stage = ${deal.stage}`
      }
    }

    await tx`
      update import_batches
      set rows_created = ${leadsCreated + dealsCreated + submissionsCreated}, rows_flagged = ${parsed.unknownStatuses.length}
      where id = ${batchId}`

    return { batchId, leadsCreated, leadsUpdated, dealsLinked, dealsCreated, submissionsCreated, submissionsUpdated, sourcesCreated }
  })

  return { kind: parsed.kind, existing: false, skipped: parsed.skipped, warnings: parsed.warnings, ...out }
}
