/**
 * בדיקת קצה לסגירת חודש (SPEC §3.3, שלב 3) על ה-dev DB — דרך ה-UI האמיתי.
 *   PIN=2468 MONTH=2026-08 node scripts/e2e-close-month.mjs
 * 1. מוודא שאין חריגים חוסמים (אחרת מדפיס ויוצא)
 * 2. מזין PIN, לוחץ "סגור חודש", מאשר
 * 3. בודק ב-DB: periods=closed + snapshot, משימה "להעביר", report_runs, ונעילה (INSERT לחודש נדחה)
 */
import { chromium } from 'playwright'
import { unlockGate } from './lib/gate.mjs'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const MONTH = process.env.MONTH ?? '2026-08'
const PIN = process.env.PIN ?? ''
const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/harel')
const [y, m] = MONTH.split('-').map(Number)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
await unlockGate(page, BASE)
page.on('dialog', (d) => d.accept())
await page.goto(`${BASE}/nissim?period=${MONTH}`, { waitUntil: 'load' })
await page.getByRole('button', { name: /הזן קוד|פתח שוב/ }).click()
await page.getByRole('textbox', { name: 'קוד' }).fill(PIN)
await page.getByRole('button', { name: 'אישור' }).click()
await page.waitForTimeout(500)

const blockers = await page.locator('text=חריגים שחוסמים סגירה').count()
if (blockers) {
  console.log('✗ יש חריגים חוסמים — הסגירה מושבתת (וזה נכון):')
  console.log(await page.locator('[data-blocker]').allTextContents())
  await browser.close(); await sql.end(); process.exit(2)
}
const closeBtn = page.getByRole('button', { name: /סגור חודש/ })
if (!(await closeBtn.isEnabled())) { console.log('✗ כפתור הסגירה מושבת'); await browser.close(); await sql.end(); process.exit(2) }
await closeBtn.click()
await page.waitForSelector('text=/החודש נסגר/', { timeout: 60_000 })
console.log('✓ UI: ' + (await page.locator('[role=status]').first().textContent()))
await page.screenshot({ path: `docs/screenshots/nissim-closed@1280.png`, fullPage: true })
await browser.close()

const [p] = await sql`select status, snapshot_json is not null as has_snapshot, closed_by from periods where division='finance' and year=${y} and month=${m}`
console.log(`✓ periods: status=${p.status} snapshot=${p.has_snapshot}`)
const [t] = await sql`select title, due_date from tasks where auto_key = ${`settlement_transfer:${MONTH}`}`
console.log(t ? `✓ task: "${t.title}" עד ${t.due_date.toISOString().slice(0, 10)}` : '  (אין משימת העברה — ניסים חייב, לא החברה)')
const [r] = await sql`select file_url from report_runs where report_type='nissim_settlement' and period=${MONTH} order by created_at desc limit 1`
console.log(r ? `✓ report_runs: ${r.file_url}` : '✗ אין report_runs')
try {
  await sql`insert into transactions (date_cash, account_id, amount_net, nature, division, category_id, deductible)
            values (${`${MONTH}-15`}, (select id from accounts limit 1), -1, 'expense', 'finance', (select id from categories limit 1), true)`
  console.log('✗ נעילה: INSERT לחודש הסגור עבר!')
} catch (e) { console.log('✓ נעילה ב-DB: ' + e.message.split('\n')[0].slice(0, 90)) }
await sql.end()
