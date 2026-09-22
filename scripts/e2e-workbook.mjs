/**
 * SPEC §9 שלב 2 מהדפדפן — ייבוא הקובץ הקיים בלי שורת פקודה.
 * זה המסלול היחיד שקיים בהתקנה מנוהלת, ולכן הוא נבדק כמו כל שאר המסכים.
 *
 *   BASE_URL=http://localhost:3000 WORKBOOK=<file.xlsx> node scripts/e2e-workbook.mjs
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import postgres from 'postgres'
import { unlockGate } from './lib/gate.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const FILE = process.env.WORKBOOK
if (!FILE || !existsSync(FILE)) { console.error('WORKBOOK=<קובץ.xlsx> חסר'); process.exit(1) }

let url = process.env.DATABASE_URL
if (!url && existsSync('.env.local')) url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1 })

const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
await unlockGate(page, BASE)
const form = () => page.locator('form').filter({ has: page.getByRole('button', { name: 'ייבא את הקובץ' }) })

try {
  step('מסך 11 — העלאת קובץ האקסל')
  await page.goto(`${BASE}/import`, { waitUntil: 'load' })
  assert(await page.getByText('קובץ האקסל של הר-אל').count() > 0, 'הכרטיס קיים במסך הייבוא')

  const [before] = await sql`select count(*)::int as n from deals where deleted_at is null`
  await form().locator('input[type=file]').setInputFiles(FILE)
  await form().getByRole('button', { name: 'ייבא את הקובץ' }).click()
  await page.waitForTimeout(30_000)

  const [after] = await sql`select
    (select count(*)::int from deals where deleted_at is null) as deals,
    (select count(*)::int from transactions where deleted_at is null) as tx,
    (select count(*)::int from advances where deleted_at is null) as adv,
    (select count(*)::int from deal_checklist_items) as items`
  assert(after.deals > before.n, `נוצרו תיקים (${before.n} → ${after.deals})`)
  assert(after.tx > 0, `${after.tx} תנועות`)
  assert(after.adv > 0, `${after.adv} מקדמות`)
  assert(after.items > 0, `${after.items} פריטי צ'קליסט — ב.5`)
  assert(await page.getByText(/תיקים ·/).count() > 0, 'המסך מדווח מה נוצר')
  assert(await page.getByText(/שורות שהקובץ מטפל בהן בשקט/).count() > 0, 'האזהרות מוצפות ולא נבלעות')

  step('§11.9 — אותו קובץ פעם שנייה')
  await page.goto(`${BASE}/import`, { waitUntil: 'load' })
  await form().locator('input[type=file]').setInputFiles(FILE)
  await form().getByRole('button', { name: 'ייבא את הקובץ' }).click()
  await page.waitForTimeout(15_000)
  assert(await page.getByText(/כבר יובא/).count() > 0, 'נאמר במפורש שהקובץ כבר יובא')
  const [again] = await sql`select count(*)::int as n from deals where deleted_at is null`
  assert(again.n === after.deals, `0 כפילויות (${again.n})`)

  step('הנתונים מגיעים למסכים')
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  assert(await page.getByText('מצב החברה').count() > 0, 'דף הבית נטען')
  await page.goto(`${BASE}/deals`, { waitUntil: 'load' })
  assert(await page.getByText(`${after.deals} תיקים`).count() > 0, 'מסך התיקים מציג את מה שיובא')

  console.log('\n✓ ייבוא מהדפדפן עובר מקצה לקצה — בלי שורת פקודה.')
} catch (e) {
  process.exitCode = 1
  console.error(String(e?.message ?? e))
} finally {
  await browser.close()
  await sql.end()
}
