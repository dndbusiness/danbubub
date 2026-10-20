/**
 * כללי המסמכים של ה-CRM — טהורים, בלי DB (נבדקים ב-tests/crm-docs.test.ts).
 * אותה התנהגות כמו מסד הנתונים של הדף ב-Claude, כדי שהדף ירוץ על השרת בלי שינוי.
 */

export type CrmDoc = Record<string, unknown>

const COLL_RE = /^[A-Za-z0-9_-]{1,64}$/

/** "clients/abc" → ['clients', 'abc']. נתיב לא חוקי → null (לא כותבים לשום מקום). */
export function parsePath(path: unknown): [coll: string, id: string] | null {
  if (typeof path !== 'string') return null
  const parts = path.split('/')
  if (parts.length !== 2) return null
  const [coll = '', id = ''] = parts
  if (!COLL_RE.test(coll) || !id || id.length > 200) return null
  return [coll, id]
}

const isDeleteMarker = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, unknown>).__delete__ === true

const isPlainObject = (v: unknown): v is CrmDoc => !!v && typeof v === 'object' && !Array.isArray(v)

/** set: המסמך כולו מוחלף. סמני מחיקה לא מותרים כאן. */
export function applySet(data: unknown): CrmDoc {
  if (!isPlainObject(data)) throw new Error('המסמך חייב להיות אובייקט')
  return stripMarkers(data, false)
}

/** update: מיזוג שדות ברמה העליונה, כמו במסד של Claude. {__delete__:true} מוחק שדה (בכל עומק). */
export function applyUpdate(current: CrmDoc | null, patch: unknown): CrmDoc {
  if (!isPlainObject(patch)) throw new Error('העדכון חייב להיות אובייקט')
  const out: CrmDoc = { ...(current ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (isDeleteMarker(v)) delete out[k]
    else out[k] = isPlainObject(v) ? stripMarkers(v, true) : v
  }
  return out
}

function stripMarkers(o: CrmDoc, allow: boolean): CrmDoc {
  const out: CrmDoc = {}
  for (const [k, v] of Object.entries(o)) {
    if (isDeleteMarker(v)) { if (!allow) throw new Error('סמן מחיקה מותר רק בעדכון'); continue }
    out[k] = isPlainObject(v) ? stripMarkers(v, allow) : v
  }
  return out
}

/** גיבוי של הדף (backupDump): { settings, collections: { name: { id: doc } } } → רשימת מסמכים. */
export interface BackupDump { app?: string; exportedAt?: string; settings?: CrmDoc; collections?: Record<string, Record<string, CrmDoc>> }

export interface DumpDoc { coll: string; id: string; data: CrmDoc }

export function docsFromDump(dump: BackupDump): { docs: DumpDoc[]; colls: string[] } {
  if (!dump || typeof dump !== 'object' || !isPlainObject(dump.collections)) throw new Error('זה לא קובץ גיבוי של ה-CRM (חסר collections)')
  const docs: DumpDoc[] = []
  const colls: string[] = []
  for (const [coll, rows] of Object.entries(dump.collections)) {
    if (!COLL_RE.test(coll) || !isPlainObject(rows)) continue
    colls.push(coll)
    for (const [id, data] of Object.entries(rows)) {
      if (!id || id.includes('/') || !isPlainObject(data)) continue
      const { id: _drop, ...rest } = data as CrmDoc & { id?: unknown }
      docs.push({ coll, id, data: rest })
    }
  }
  if (isPlainObject(dump.settings)) { docs.push({ coll: 'settings', id: 'main', data: dump.settings }); colls.push('settings') }
  return { docs, colls }
}

/**
 * הכיוון ההפוך של docsFromDump: מסמכי השרת → קובץ גיבוי באותו מבנה כמו backupDump של הדף,
 * כך שהוא משוחזר באותה דרך (scripts/crm-mirror.mjs / POST /api/crm/import). settings/main → settings.
 */
export function dumpFromDocs(rows: { coll: string; doc_id: string; data: CrmDoc }[], exportedAt: string, skip: readonly string[] = []):
  BackupDump & { source: 'server'; counts: Record<string, number> } {
  const collections: Record<string, Record<string, CrmDoc>> = {}
  const counts: Record<string, number> = {}
  let settings: CrmDoc | undefined
  for (const r of rows) {
    if (skip.includes(r.coll) || !COLL_RE.test(r.coll)) continue
    if (r.coll === 'settings' && r.doc_id === 'main') { settings = r.data; continue }
    ;(collections[r.coll] ??= {})[r.doc_id] = r.data
    counts[r.coll] = (counts[r.coll] ?? 0) + 1
  }
  return { app: 'harel-crm', source: 'server', exportedAt, ...(settings ? { settings } : {}), collections, counts }
}
