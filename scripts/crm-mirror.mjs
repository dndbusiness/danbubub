/**
 * שכפול ה-CRM מהדף ב-Claude לשרת: קובץ הגיבוי היומי (harel-crm-YYYY-MM-DD.json / .json.gz,
 * מצורף למייל "[הר-אל] גיבוי CRM" ונשמר בדרייב) → טבלת crm_docs.
 *
 *   node --experimental-strip-types scripts/crm-mirror.mjs <harel-crm-….json[.gz]>
 *
 * אותה פונקציה בדיוק כמו POST /api/crm/import (הנחיה 20 — מנוע אחד). idempotent:
 * ריצה שנייה על אותו קובץ = 0 כתיבות.
 *
 *   --live    אחרי הייבוא: crm_mode = live — עובדים מהשרת, הפס "מצב שכפול" נעלם והג'וב crm_mirror מדלג
 *   --force   ייבוא גם אחרי המעבר (שחזור מכוון — דורס את מה שנעשה בשרת באוספים שבקובץ)
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./ts-resolve.mjs', pathToFileURL(import.meta.filename))

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) { console.error('שימוש: crm-mirror.mjs <harel-crm-….json[.gz]>'); process.exit(1) }
const buf = readFileSync(file)
const dump = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8'))

const { importMirror, setCrmMode } = await import('../lib/crm/store.ts')
const { sql } = await import('../lib/db.ts')
const r = await importMirror(dump, { force: args.includes('--force') }).catch(async (e) => {
  console.error('✗ ' + e.message + (e.code === 'failed_precondition' ? '\n  לשחזור מכוון: --force' : ''))
  await sql.end(); process.exit(1)
})
console.log(`✓ ${r.total} מסמכים · נכתבו ${r.written} · ללא שינוי ${r.unchanged} · סומנו כמחוקים ${r.removed}`)
console.log('  אוספים: ' + r.colls.join(', '))
if (args.includes('--live')) { await setCrmMode('live'); console.log('✓ המעבר בוצע: crm_mode = live — עובדים מהשרת') }
await sql.end()
