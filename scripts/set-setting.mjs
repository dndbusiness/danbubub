/**
 * הגדרה ב-settings (jsonb). הערך הוא JSON:
 *   node scripts/set-setting.mjs notify_whatsapp_dan '"972501234567"'
 *   node scripts/set-setting.mjs alert_thresholds '{"dailyVarianceShekels":2000}'
 */
import postgres from 'postgres'
import { readFileSync, existsSync } from 'node:fs'

const [key, raw] = process.argv.slice(2)
if (!key || raw === undefined) { console.error('שימוש: node scripts/set-setting.mjs <key> <json>'); process.exit(1) }
let url = process.env.DATABASE_URL
if (!url && existsSync('.env.local')) url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const value = JSON.parse(raw)
const sql = postgres(url, { max: 1 })
await sql`insert into settings (key, value, description) values (${key}, ${sql.json(value)}, 'הוגדר ע"י scripts/set-setting.mjs')
          on conflict (key) do update set value = excluded.value, updated_at = now()`
console.log(`✓ ${key} = ${raw}`)
await sql.end()
