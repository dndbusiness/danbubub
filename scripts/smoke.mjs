/**
 * בדיקת הפעלה מלאה — מריץ את כל 13 הג'ובים של חלק ג' מול שרת חי ומדווח.
 * אותו סקריפט עובד מקומית ומול הפרודקשן:
 *   node scripts/smoke.mjs
 *   BASE_URL=https://harel.vercel.app JOBS_SECRET=… node scripts/smoke.mjs
 *
 * לא משנה נתונים עסקיים: הג'ובים idempotent (rule_key / dedup_key), והרצה חוזרת
 * לא מייצרת כפילויות. db_backup כותב קובץ גיבוי — זו כל ה"תופעה".
 */
import { readFileSync, existsSync } from 'node:fs'

if (existsSync('.env.local')) for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2] }
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SECRET = process.env.JOBS_SECRET ?? ''

/** הסדר שבו הם רצים ביום אמיתי (חלק ג'). */
const JOBS = [
  ['gmail_scan', 'סריקת Gmail לחשבוניות (ב.3)'],
  ['drive_intake_scan', 'סריקת תיקיית "להזנה" (ב.3)'],
  ['day_close', 'סגירת יום (§3.6)'],
  ['alerts_eval', 'הערכת התראות (ב.11)'],
  ['daily_summary', 'סיכום יומי (ב.4)'],
  ['anchor_reminder', 'תזכורת עוגן'],
  ['calendar_sync', 'אירועי יומן (ב.2)'],
  ['weekly_report', 'דוח שבועי (ב.7)'],
  ['pnl_draft', 'רווח והפסד — טיוטה (ב.7)'],
  ['pnl_final', 'רווח והפסד — סופי (ב.7)'],
  ['accountant_pack', 'חומר סגירה לרו"ח (ב.7)'],
  ['deal_decay', 'רקב תיקים (§2.3)'],
  ['db_backup', 'גיבוי DB (§6)'],
  ['greeninvoice_import', 'תזכורת ייצוא חשבונית ירוקה (§4.3)'],
]

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length))
let failed = 0, skipped = 0, ok = 0

console.log(`\n→ ${BASE}\n`)
const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch((e) => ({ status: 'down', error: e.message }))
console.log(`בריאות: ${health.status}${health.db ? ` · ${health.db.tables} טבלאות · ${health.db.views} views · ${health.latencyMs}ms` : ` · ${health.error ?? ''}`}`)
if (health.status === 'down') { console.error('✗ השרת או ה-DB לא עונים — אין טעם להמשיך.'); process.exit(1) }
console.log('')

for (const [name, label] of JOBS) {
  const started = Date.now()
  let body, code
  try {
    const res = await fetch(`${BASE}/api/jobs/${name}`, { method: 'POST', headers: SECRET ? { 'x-jobs-secret': SECRET } : {} })
    code = res.status
    body = await res.json()
  } catch (e) { code = 0; body = { error: e.message } }
  const ms = Date.now() - started
  if (code !== 200 || body.error) { failed++; console.log(`✗ ${pad(name, 20)} ${pad(label, 32)} ${body.error ?? `HTTP ${code}`}`) }
  else if (body.skipped) { skipped++; console.log(`⚠ ${pad(name, 20)} ${pad(label, 32)} ${body.skipped}`) }
  else { ok++; console.log(`✓ ${pad(name, 20)} ${pad(label, 32)} ${body.rowsTouched ?? 0} שורות · ${ms}ms`) }
}

console.log(`\n✓ ${ok} רצו · ⚠ ${skipped} דילגו (חסר חיבור/נתונים) · ✗ ${failed} נכשלו`)
if (!failed) console.log('אין כשלים. הג׳ובים שדילגו יתחילו לעבוד כשהחיבור או הנתונים יהיו שם.')
process.exit(failed ? 1 : 0)
