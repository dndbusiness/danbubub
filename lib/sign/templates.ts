/**
 * ספריית תבניות PDF (019 sign_templates) — "מסמכי מערכת" לכל המשרד ו"מסמכים אישיים",
 * מסודרות לפי סוג (בנק / ביטוח / קרן…) וגוף (בנק לאומי, הפניקס…).
 * תבנית = קובץ (stored_files) + שדות לכל לווה. שליחה מתבנית מעתיקה את השדות למעטפה
 * (שינוי מאוחר בתבנית לא משנה מסמך שכבר נשלח).
 */
import { z } from 'zod'
import { sql } from '@/lib/db'
import { readStoredFile } from '@/lib/files'
import { cleanField, mostActive, signersNeeded, validatePdfFields, type PageSize, type PdfField } from '@/lib/rules/sign-pdf'
import { SIGN_CATEGORIES, type SignCategory } from '@/lib/rules/sign'
import { readPageSizes } from './pdf'

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

/** הספרייה למשתמש: מערכת + האישיות שלו. עם "הכי פעילות" ב-90 הימים האחרונים. */
export async function listTemplates(viewer: string | null, now: Date): Promise<{ templates: (TemplateRow & { uses: number })[]; top: { id: string; n: number }[] }> {
  const rows = await sql<TemplateRow[]>`
    select * from sign_templates where deleted_at is null and (scope = 'system' or owner_key = ${viewer ?? ''})
    order by category, coalesce(folder, ''), name`
  const since = new Date(now.getTime() - 90 * 86_400_000)
  const used = await sql<{ template_key: string | null; created_at: string }[]>`
    select template_key, created_at from sign_envelopes where deleted_at is null and template_key like 'pdf:%' and created_at >= ${since}`
  const counts = mostActive(used, since, 1000)
  const n = new Map(counts.map((c) => [c.key, c.n]))
  return {
    templates: rows.map((t) => ({ ...t, uses: n.get(templateKey(t.id)) ?? 0 })),
    top: counts.filter((c) => rows.some((t) => templateKey(t.id) === c.key)).slice(0, 5).map((c) => ({ id: c.key.slice(4), n: c.n })),
  }
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

