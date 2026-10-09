/**
 * שכפול ה-CRM מהדף ב-Claude לשרת: קובץ הגיבוי היומי (harel-crm-YYYY-MM-DD.json / .json.gz,
 * מצורף למייל "[הר-אל] גיבוי CRM" ונשמר בדרייב) → טבלת crm_docs.
 *
 *   node --experimental-strip-types scripts/crm-mirror.mjs <harel-crm-….json[.gz]>
 *
 * אותה פונקציה בדיוק כמו POST /api/crm/import (הנחיה 20 — מנוע אחד). idempotent:
 * ריצה שנייה על אותו קובץ = 0 כתיבות.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./ts-resolve.mjs', pathToFileURL(import.meta.filename))

const file = process.argv[2]
if (!file) { console.error('שימוש: crm-mirror.mjs <harel-crm-….json[.gz]>'); process.exit(1) }
const buf = readFileSync(file)
const dump = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8'))

const { importMirror } = await import('../lib/crm/store.ts')
const { sql } = await import('../lib/db.ts')
const r = await importMirror(dump)
console.log(`✓ ${r.total} מסמכים · נכתבו ${r.written} · ללא שינוי ${r.unchanged} · סומנו כמחוקים ${r.removed}`)
console.log('  אוספים: ' + r.colls.join(', '))
await sql.end()
