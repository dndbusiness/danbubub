/**
 * ספריית ההסכמים מהמאגר (data/agreements/*.md) — קריאה מהדיסק וטעינה ל-settings.signLibrary.
 * הכללים (פענוח, מיזוג idempotent, אישור) ב-lib/rules/agreements.ts.
 * הקבצים נכללים בפונקציות של Vercel דרך outputFileTracingIncludes (next.config.ts).
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from '@/lib/db'
import { writeDoc } from '@/lib/crm/store'
import { mergeLibrary, parseAgreement, type LibItem, type LibTemplate, type LoadReport } from '@/lib/rules/agreements'

export const AGREEMENTS_DIR = path.join(process.cwd(), 'data', 'agreements')

export async function readAgreements(dir = AGREEMENTS_DIR): Promise<{ templates: LibTemplate[]; errors: string[] }> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md')).sort()
  const templates: LibTemplate[] = [], errors: string[] = []
  for (const n of names) {
    const r = parseAgreement(await readFile(path.join(dir, n), 'utf8'), n)
    if (r.ok) templates.push(r.tpl); else errors.push(...r.errors)
  }
  const dup = templates.map((t) => t.key).filter((k, i, a) => a.indexOf(k) !== i)
  if (dup.length) errors.push('key כפול: ' + [...new Set(dup)].join(', '))
  return { templates: templates.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)), errors }
}

async function currentLibrary(): Promise<LibItem[]> {
  const [r] = await sql<{ data: { signLibrary?: LibItem[] } }[]>`select data from crm_docs where coll = 'settings' and doc_id = 'main' and deleted_at is null`
  return Array.isArray(r?.data?.signLibrary) ? r!.data.signLibrary! : []
}

/** תצוגה מקדימה (dryRun) או טעינה. בטעינה כותבים רק אם משהו השתנה. */
export async function loadLibrary(opts: { by: string; at: Date; overwrite?: string[]; dryRun?: boolean }):
  Promise<{ report: LoadReport[]; errors: string[]; written: boolean; signLibrary: LibItem[] }> {
  const { templates, errors } = await readAgreements()
  const current = await currentLibrary()
  const { library, report } = mergeLibrary(current, templates, { at: opts.at.toISOString(), by: opts.by, overwrite: opts.overwrite })
  const changed = report.some((r) => r.action === 'added' || r.action === 'updated' || r.action === 'overwritten')
  if (!opts.dryRun && changed && !errors.length) await writeDoc('settings/main', 'update', { signLibrary: library })
  return { report, errors, written: !opts.dryRun && changed && !errors.length, signLibrary: opts.dryRun ? current : library }
}
