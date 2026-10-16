/**
 * מגדיר PIN לאזור מוגן (SPEC §6). node scripts/set-pin.mjs nissim 1234
 * נשמר כ-sha256(salt:pin) ב-settings.pin_hash_<area>. הקוד עצמו לא נשמר בשום מקום.
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const [area, pin] = process.argv.slice(2)
if (!['nissim', 'partners', 'private', 'bank'].includes(area) || !/^\d{4,6}$/.test(pin ?? '')) {
  console.error('שימוש: set-pin.mjs <nissim|partners|private|bank> <4–6 ספרות>'); process.exit(1)
}
let url = process.env.DATABASE_URL
if (!url) { try { url = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='))?.slice(13) } catch {} }
const sql = postgres(url)
const salt = randomBytes(16).toString('hex')
const hash = createHash('sha256').update(`${salt}:${pin}`).digest('hex')
await sql`insert into settings (key, value, description) values (${`pin_hash_${area}`}, ${sql.json({ salt, hash })}, 'SPEC §6 — PIN לאזור מוגן (hash)')
          on conflict (key) do update set value = excluded.value, updated_at = now()`
await sql.end()
console.log(`✓ PIN לאזור "${area}" הוגדר`)
