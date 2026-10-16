/**
 * ייבוא חד-פעמי מהקובץ הקיים → DB. SPEC §9 שלב 2, §11.9 (idempotent).
 *
 *   node --experimental-strip-types scripts/import-workbook.mjs <file.xlsx> [--year 2026] [--as-of YYYY-MM-DD] [--dry-run]
 *
 * הכתיבה עצמה ב-lib/import/workbook-load.ts — אותה פונקציה בדיוק שמפעיל מסך
 * הייבוא בדפדפן, כדי שלא יהיו שני מסלולי ייבוא שמתפצלים.
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

// lib/rules מייבא עם סיומת .js (כתיב TS/ESM); ההוק ממפה אותה ל-.ts.
register('./ts-resolve.mjs', pathToFileURL(import.meta.filename))

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { year: { type: 'string' }, 'as-of': { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
})
const file = positionals[0]
if (!file) {
  console.error('שימוש: import-workbook.mjs <file.xlsx> [--year 2026] [--as-of YYYY-MM-DD] [--dry-run]')
  process.exit(1)
}

const importDate = args['as-of'] ?? new Date().toISOString().slice(0, 10)
const year = Number(args.year ?? importDate.slice(0, 4))
const buf = readFileSync(file)

// DATABASE_URL מהסביבה, או מ-.env.local (כמו Next) — כדי שאותו קובץ ישמש גם את הסקריפט.
if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync('.env.local', 'utf8')
    const url = env.split('\n').map((l) => l.trim())
      .find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '')
    if (url) process.env.DATABASE_URL = url
  } catch { /* אין קובץ */ }
}

const { parseWorkbook } = await import('../lib/import/workbook.ts')
const { readWorkbookSheets } = await import('../lib/import/workbook-load.ts')

if (args['dry-run']) {
  const bundle = parseWorkbook(readWorkbookSheets(buf), { year, importDate })
  console.log(`→ ${bundle.deals.length} תיקים · ${bundle.transactions.length} תנועות · ${bundle.advances.length} מקדמות · ${bundle.warnings.length} אזהרות`)
  for (const w of bundle.warnings) console.log(`   ⚠ ${w.kind}  ${w.sourceRef}  ${w.message}`)
  process.exit(0)
}

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL לא מוגדר (סביבה או .env.local)'); process.exit(1) }

const { loadWorkbook } = await import('../lib/import/workbook-load.ts')
const { sql } = await import('../lib/db.ts')
const r = await loadWorkbook(buf, { fileName: file.split('/').pop(), year, importDate })
for (const w of r.warnings) console.log(`   ⚠ ${w.kind}  ${w.sourceRef}  ${w.message}`)
console.log(r.alreadyImported
  ? '→ הקובץ הזה כבר יובא (אותו תוכן). 0 שורות חדשות.'
  : `✓ נוצרו: ${r.deals} תיקים · ${r.transactions} תנועות · ${r.advances} מקדמות · ${r.plans} שורות לוח תקבולים`)
await sql.end()
