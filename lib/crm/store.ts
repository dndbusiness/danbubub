/**
 * מסמכי ה-CRM על השרת (טבלה crm_docs, סכימה 015). כל כתיבה עוברת דרך withActor
 * כדי שיומן השינויים (audit_log) יידע מי כתב.
 */
import { sql, withActor } from '@/lib/db'
import { applySet, applyUpdate, docsFromDump, parsePath, type BackupDump, type CrmDoc } from '@/lib/crm/docs.js'

export interface Change { coll: string; id: string; seq: number; data: CrmDoc | null }

/** כל מה שהשתנה אחרי seq — כולל מחיקות (data = null). הדף מושך את זה כל כמה שניות. */
export async function changesSince(after: number, colls: string[] | null, limit = 5000): Promise<Change[]> {
  const rows = await sql<{ coll: string; doc_id: string; seq: string; data: CrmDoc; deleted: boolean }[]>`
    select coll, doc_id, seq::text, data, deleted_at is not null as deleted
    from crm_docs
    where seq > ${after} and (${colls}::text[] is null or coll = any(${colls}::text[]))
    order by seq limit ${limit}`
  return rows.map((r) => ({ coll: r.coll, id: r.doc_id, seq: Number(r.seq), data: r.deleted ? null : r.data }))
}

export type WriteOp = 'set' | 'update' | 'delete'

export async function writeDoc(path: string, op: WriteOp, data: unknown): Promise<{ seq: number }> {
  const p = parsePath(path)
  if (!p) throw Object.assign(new Error('נתיב לא חוקי'), { code: 'invalid_argument' })
  const [coll, id] = p
  return withActor(async (tx) => {
    if (op === 'delete') {
      const [r] = await tx<{ seq: string }[]>`
        update crm_docs set deleted_at = now(), seq = nextval('crm_docs_seq')
        where coll = ${coll} and doc_id = ${id} and deleted_at is null returning seq::text`
      return { seq: r ? Number(r.seq) : 0 }
    }
    let next: CrmDoc
    if (op === 'update') {
      const [cur] = await tx<{ data: CrmDoc }[]>`
        select data from crm_docs where coll = ${coll} and doc_id = ${id} and deleted_at is null for update`
      next = applyUpdate(cur?.data ?? null, data)
    } else next = applySet(data)
    const [r] = await tx<{ seq: string }[]>`
      insert into crm_docs (coll, doc_id, data, source, created_by)
      values (${coll}, ${id}, ${tx.json(next as never)}, 'app', current_actor())
      on conflict (coll, doc_id) do update
        set data = excluded.data, source = 'app', deleted_at = null, seq = nextval('crm_docs_seq')
      returning seq::text`
    return { seq: Number(r?.seq ?? 0) }
  })
}

export interface MirrorResult { total: number; written: number; unchanged: number; removed: number; colls: string[] }

export type CrmMode = 'mirror' | 'live'

/** 'live' = עובדים מכאן והשרת הוא המקור; עד אז — שכפול מהדף ב-Claude. */
export async function crmMode(): Promise<CrmMode> {
  const [r] = await sql<{ value: unknown }[]>`select value from settings where key = 'crm_mode'`
  return r?.value === 'live' ? 'live' : 'mirror'
}

export async function setCrmMode(mode: CrmMode): Promise<void> {
  await withActor((tx) => tx`
    insert into settings (key, value, description, updated_by) values ('crm_mode', ${tx.json(mode as never)}, 'mirror = שכפול מהדף ב-Claude · live = עובדים מכאן', current_actor())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`)
}

/**
 * שכפול מהגיבוי של הדף ב-Claude. idempotent (הנחיה 9): מסמך זהה לא נכתב שוב,
 * ומה שנמחק שם מסומן deleted_at כאן — באוספים שהגיבוי מכיל בלבד.
 * אחרי המעבר (crm_mode = live) גיבוי ישן היה דורס עבודה שנעשתה כאן — נדחה, אלא אם force (שחזור מכוון).
 */
export async function importMirror(dump: BackupDump, opts: { force?: boolean } = {}): Promise<MirrorResult> {
  const { docs, colls } = docsFromDump(dump)
  if (!opts.force && (await crmMode()) === 'live') throw Object.assign(new Error('המעבר כבר בוצע — עובדים מהמערכת הזו, וגיבוי מהדף ב-Claude היה דורס את מה שנעשה כאן'), { code: 'failed_precondition' })
  return withActor(async (tx) => {
    let written = 0
    // במנות: שאילתה לכל מסמך = אלפי סבבים מול מסד מרוחק, מעבר לתקרת הזמן של פונקציה בענן.
    // מפתח כפול באותה מנה נדחה ב-ON CONFLICT — לכן אחד לכל מפתח (האחרון גובר).
    const rows = [...new Map(docs.map((d) => [d.coll + '/' + d.id, { coll: d.coll, doc_id: d.id, data: d.data }])).values()]
    for (let i = 0; i < rows.length; i += 200) {
      const r = await tx`
        insert into crm_docs (coll, doc_id, data, source, created_by)
        select x.coll, x.doc_id, x.data, 'mirror', current_actor()
        from jsonb_to_recordset(${tx.json(rows.slice(i, i + 200) as never)}) as x(coll text, doc_id text, data jsonb)
        on conflict (coll, doc_id) do update
          set data = excluded.data, source = 'mirror', deleted_at = null, seq = nextval('crm_docs_seq')
          where crm_docs.data is distinct from excluded.data or crm_docs.deleted_at is not null`
      written += r.count
    }
    const keys = docs.map((d) => d.coll + '/' + d.id)
    const gone = await tx`
      update crm_docs set deleted_at = now(), seq = nextval('crm_docs_seq')
      where coll = any(${colls}::text[]) and deleted_at is null and not (id = any(${keys}::text[]))`
    await tx`
      insert into settings (key, value, updated_by) values ('crm_mirror_last', ${tx.json({ at: new Date().toISOString(), exportedAt: dump.exportedAt ?? null, total: rows.length } as never)}, current_actor())
      on conflict (key) do update set value = excluded.value`
    return { total: rows.length, written, unchanged: rows.length - written, removed: gone.count, colls }
  })
}

/** מי הבעלים בדף — המזהה שהדף ב-Claude נתן לדן (נשמר במסמכי team), כדי ש"by" יישאר עקבי. */
export async function ownerIdentity(): Promise<{ id: string; name: string }> {
  const env = process.env.CRM_OWNER_ID
  const [t] = await sql<{ doc_id: string; data: CrmDoc }[]>`
    select doc_id, data from crm_docs where coll = 'team' and deleted_at is null
      and (${env ?? null}::text is not null and doc_id = ${env ?? null} or data->>'resp' = 'dan')
    order by (doc_id = ${env ?? ''}) desc limit 1`
  return { id: t?.doc_id ?? env ?? 'owner', name: process.env.CRM_OWNER_NAME ?? 'דן' }
}
