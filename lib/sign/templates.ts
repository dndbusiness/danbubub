/**
 * ספריית תבניות PDF (019 sign_templates) — "מסמכי מערכת" לכל המשרד ו"מסמכים אישיים",
 * מסודרות לפי סוג (בנק / ביטוח / קרן…) וגוף (בנק לאומי, הפניקס…).
 * תבנית = קובץ (stored_files) + שדות לכל לווה. שליחה מתבנית מעתיקה את השדות למעטפה
 * (שינוי מאוחר בתבנית לא משנה מסמך שכבר נשלח).
 */
import { z } from 'zod'
import { sql } from '@/lib/db'
import { readStoredFile } from '@/lib/files'
import { bundleFields, cleanField, mostActive, signersNeeded, validatePdfFields, type PageSize, type PdfField } from '@/lib/rules/sign-pdf'
import { SIGN_CATEGORIES, type SignCategory } from '@/lib/rules/sign'
import { readPageSizes } from './pdf'
import { formTypeOf, type FormType } from '@/lib/rules/form-types'
import { curatedFor } from './curated'

export interface TemplateRow {
  id: string; name: string; category: SignCategory; folder: string | null; scope: 'system' | 'personal'; owner_key: string | null
  division: 'finance' | 'realestate' | null; file_id: string; page_sizes: PageSize[]; fields: PdfField[]; signers: number; require_otp: boolean
  created_at: string; updated_at: string
}
export interface TemplateInput {
  name: string; category: SignCategory; folder?: string | null; scope?: 'system' | 'personal'; ownerKey?: string | null
  division?: 'finance' | 'realestate' | null; fileId: string; fields: PdfField[]; requireOtp?: boolean
}

export const templateKey = (id: string) => 'pdf:' + id

async function checked(input: TemplateInput): Promise<{ pages: PageSize[]; signers: number } | { error: string }> {
  if (!(input.category in SIGN_CATEGORIES)) return { error: 'סוג לא מוכר' }
  if (input.scope === 'personal' && !input.ownerKey) return { error: 'תבנית אישית — חסר המשתמש' }
  const f = await readStoredFile(input.fileId)
  if (!f) return { error: 'הקובץ לא נמצא — העלו שוב' }
  const pages = await readPageSizes(f.bytes).catch(() => null)
  if (!pages) return { error: 'הקובץ לא נקרא כ-PDF' }
  const signers = signersNeeded(input.fields)
  const errs = validatePdfFields(input.fields, pages.length, Math.max(1, signers))
  if (errs.length) return { error: errs.join(' · ') }
  if (signers > 6) return { error: 'עד 6 חותמים' }
  return { pages, signers }
}

export async function createTemplate(input: TemplateInput): Promise<{ id: string } | { error: string }> {
  const c = await checked(input)
  if ('error' in c) return c
  const [r] = await sql<{ id: string }[]>`
    insert into sign_templates (name, category, folder, scope, owner_key, division, file_id, page_sizes, fields, signers, require_otp)
    values (${input.name.trim()}, ${input.category}, ${input.folder?.trim() || null}, ${input.scope ?? 'system'}, ${input.scope === 'personal' ? input.ownerKey ?? null : null},
            ${input.division ?? null}, ${input.fileId}, ${sql.json(c.pages as never)}, ${sql.json(input.fields as never)}, ${c.signers}, ${Boolean(input.requireOtp)})
    returning id`
  return { id: r!.id }
}

export async function updateTemplate(id: string, input: TemplateInput): Promise<{ ok: true } | { error: string }> {
  const c = await checked(input)
  if ('error' in c) return c
  const r = await sql`
    update sign_templates set name = ${input.name.trim()}, category = ${input.category}, folder = ${input.folder?.trim() || null}, scope = ${input.scope ?? 'system'},
      owner_key = ${input.scope === 'personal' ? input.ownerKey ?? null : null}, division = ${input.division ?? null}, file_id = ${input.fileId},
      page_sizes = ${sql.json(c.pages as never)}, fields = ${sql.json(input.fields as never)}, signers = ${c.signers}, require_otp = ${Boolean(input.requireOtp)}
    where id = ${id} and deleted_at is null`
  return r.count ? { ok: true } : { error: 'התבנית לא נמצאה' }
}

export async function deleteTemplate(id: string, now: Date): Promise<boolean> {
  const r = await sql`update sign_templates set deleted_at = ${now} where id = ${id} and deleted_at is null`
  return r.count > 0
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const [r] = await sql<TemplateRow[]>`select * from sign_templates where id = ${id} and deleted_at is null`
  return r ?? null
}

/**
 * "ללמוד כל מסמך איפה למלא" (דן, 18/10): קובץ שהועלה וזהה בדיוק (SHA-256) לקובץ של תבנית בספרייה —
 * מחזיר את התבנית, והדף טוען את השדות שכבר הוצבו עליה. תבנית אישית — רק לבעליה.
 */
export async function templateForFile(sha: string, viewer: string | null): Promise<Pick<TemplateRow, 'id' | 'name' | 'fields' | 'signers' | 'folder' | 'category'> | null> {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null
  const [r] = await sql<Pick<TemplateRow, 'id' | 'name' | 'fields' | 'signers' | 'folder' | 'category'>[]>`
    select t.id, t.name, t.fields, t.signers, t.folder, t.category from sign_templates t join stored_files f on f.id = t.file_id
    where f.sha256 = ${sha} and t.deleted_at is null and (t.scope = 'system' or t.owner_key = ${viewer ?? ''})
    order by t.updated_at desc limit 1`
  return r ?? null
}

/** כמה תבניות כמסמך אחד ("חבילה"): הקבצים מאוחדים לפי הסדר, השדות עוברים לעמוד הנכון, מזהי השדות ייחודיים. */
export async function bundleTemplates(ids: string[], readBytes: (fileId: string) => Promise<Uint8Array | null>, merge: (files: { name: string; bytes: Uint8Array }[]) => Promise<{ bytes: Uint8Array; pages: PageSize[] }>):
  Promise<{ bytes: Uint8Array; fields: PdfField[]; names: string[]; requireOtp: boolean } | { error: string }> {
  const ts: TemplateRow[] = []
  for (const id of ids) { const t = await getTemplate(id); if (!t) return { error: 'אחד הטפסים לא נמצא בספרייה' }; ts.push(t) }
  const files: { name: string; bytes: Uint8Array }[] = []
  for (const t of ts) { const b = await readBytes(t.file_id); if (!b) return { error: `הקובץ של "${t.name}" לא נמצא` }; files.push({ name: t.name, bytes: b }) }
  const merged = await merge(files)
  const fields = bundleFields(ts.map((t) => ({ fields: t.fields, pages: t.page_sizes.length })))
  return { bytes: merged.bytes, fields, names: ts.map((t) => t.name), requireOtp: ts.some((t) => t.require_otp) }
}

/** הספרייה למשתמש: מערכת + האישיות שלו. עם "הכי פעילות" ב-90 הימים האחרונים. */
export async function listTemplates(viewer: string | null, now: Date): Promise<{ templates: (TemplateRow & { uses: number; type: FormType; curated: boolean })[]; top: { id: string; n: number }[] }> {
  const rows = await sql<(TemplateRow & { sha256?: string | null })[]>`
    select t.*, f.sha256 from sign_templates t left join stored_files f on f.id = t.file_id
    where t.deleted_at is null and (t.scope = 'system' or t.owner_key = ${viewer ?? ''})
    order by t.category, coalesce(t.folder, ''), t.name`
  const since = new Date(now.getTime() - 90 * 86_400_000)
  const used = await sql<{ template_key: string | null; created_at: string }[]>`
    select template_key, created_at from sign_envelopes where deleted_at is null and template_key like 'pdf:%' and created_at >= ${since}`
  const counts = mostActive(used, since, 1000)
  const n = new Map(counts.map((c) => [c.key, c.n]))
  return {
    // סוג הטופס: מהשדות המוכנים אם הקובץ מוכר, אחרת מהשם. curated — השדות שנבדקו מראש (הדף מציע להחיל אותם)
    templates: rows.map(({ sha256, ...t }) => { const c = sha256 ? curatedFor(sha256) : null
      return { ...t, uses: n.get(templateKey(t.id)) ?? 0, type: c?.type ?? formTypeOf(t.name), curated: !!c && c.pages === t.page_sizes.length } }),
    top: counts.filter((c) => rows.some((t) => templateKey(t.id) === c.key)).slice(0, 5).map((c) => ({ id: c.key.slice(4), n: c.n })),
  }
}

/**
 * טפסים שכבר בספרייה (יובאו לפני שהשדות המוכנים נוספו, או סומנו "לבדיקה"): אם הקובץ שלהם הוא טופס מוכן
 * (אותה טביעה) — השדות מוחלפים בשדות שנבדקו. רק התבניות שהדף שלח (אלה שעוד לא נבדקו ידנית).
 */
export async function applyCurated(ids: string[]): Promise<{ applied: string[] }> {
  const want = ids.filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 500)
  if (!want.length) return { applied: [] }
  const rows = await sql<(TemplateRow & { sha256: string | null })[]>`
    select t.*, f.sha256 from sign_templates t join stored_files f on f.id = t.file_id
    where t.id = any(${want}) and t.deleted_at is null and t.scope = 'system'`
  const applied: string[] = []
  for (const t of rows) {
    const c = t.sha256 ? curatedFor(t.sha256) : null
    if (!c || c.pages !== t.page_sizes.length) continue
    const r = await updateTemplate(t.id, { name: t.name, category: t.category, folder: t.folder, scope: 'system', ownerKey: null, division: t.division, fileId: t.file_id, fields: c.fields, requireOtp: t.require_otp })
    if ('ok' in r) applied.push(t.id)
  }
  return { applied }
}

/** גוף הבקשה מהדף (POST / PUT). */
const TemplateBody = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(['agreement', 'bank', 'fund', 'insurance', 'poa', 'general']),
  folder: z.string().max(120).nullish(),
  scope: z.enum(['system', 'personal']).default('system'),
  ownerKey: z.string().max(80).nullish(),
  division: z.enum(['finance', 'realestate']).nullish(),
  fileId: z.string().uuid(),
  fields: z.array(z.unknown()).max(300),
  requireOtp: z.boolean().optional(),
})

export function parseTemplate(body: unknown) {
  const p = TemplateBody.safeParse(body)
  if (!p.success) return { error: 'בקשה לא תקינה: ' + p.error.issues.map((i) => i.path.join('.')).join(', ') }
  const fields = p.data.fields.map(cleanField)
  if (fields.some((f) => !f)) return { error: 'שדה לא תקין במסמך' }
  return { input: { ...p.data, fields: fields as NonNullable<ReturnType<typeof cleanField>>[] } }
}

