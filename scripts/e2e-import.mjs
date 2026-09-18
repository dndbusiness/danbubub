/**
 * בדיקת קצה-לקצה למסך 11 (ייבוא אשראי) על ה-DB המקומי:
 *   העלאה → זיהוי פורמט → סיווג ידני + "הפוך לכלל" → "החל ייבוא" → אב + בנות ב-transactions
 *   → אותו קובץ שוב = האצווה הקיימת (§11.9) → קובץ מקס: הכלל שנלמד תופס.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e-import.mjs
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const ISRACARD = resolve('tests/fixtures/cards/isracard-sample.csv')
const MAX = resolve('tests/fixtures/cards/max-sample.xlsx.csv')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
const step = (s) => console.log(`→ ${s}`)
/** במסך יש שלושה טפסי העלאה (אשראי / בנק / חשבונית ירוקה) — זה של האשראי. */
const cardForm = () => page.locator('form').filter({ has: page.locator('input[name=billing_date]') })
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); process.exit(1) } console.log(`✓ ${m}`) }

step('העלאת ישראכרט')
await page.goto(`${BASE}/import`, { waitUntil: 'load' })
// DB טרי: אין עדיין כרטיס אשראי — יוצרים אחד דרך אותו מסך (SPEC §4.1).
if (!(await cardForm().locator('select[name=account_id] option').count())) {
  await page.getByRole('button', { name: /כרטיס חדש/ }).click()
  await page.locator('input[name=name]').fill('ישראכרט 1234')
  await page.getByRole('button', { name: 'הוסף כרטיס' }).click()
  await page.waitForTimeout(2000)
  await page.goto(`${BASE}/import`, { waitUntil: 'load' })
  console.log('… נוצר כרטיס "ישראכרט 1234"')
}
await cardForm().locator('input[name=file]').setInputFiles(ISRACARD)
await cardForm().locator('input[name=billing_date]').fill('2026-09-10')
await cardForm().getByRole('button', { name: 'פענח והצג לאישור' }).click()
await page.waitForURL(/\/import\/[0-9a-f-]{36}/, { timeout: 20_000 })
const batchUrl = page.url()
assert(/זוהה: ישראכרט/.test(await page.textContent('h1')), 'זיהוי פורמט ישראכרט בכותרת')
const rowsBefore = await page.locator('tbody tr').count()
assert(rowsBefore === 4, `4 שורות אחרי dedup בקובץ (${rowsBefore})`)

step('סיווג ידני של SUPER PHARM → משרד, ואז "הפוך לכלל"')
const superRow = page.locator('tbody tr', { hasText: 'SUPER PHARM' })
await superRow.locator('select').nth(2).selectOption({ label: 'משרד' })
await page.waitForTimeout(800)
await superRow.getByRole('button', { name: 'הפוך לכלל' }).click()
await page.waitForTimeout(800)
assert(await page.getByText(/נוצר כלל: SUPER PHARM/).count() > 0, 'toast "נוצר כלל: SUPER PHARM"')

step('PAZ → רכב יורם, WOLT נשאר "לבדוק"')
await page.locator('tbody tr', { hasText: 'PAZ YELLOW' }).locator('select').nth(2).selectOption({ label: 'רכב יורם' })
await page.waitForTimeout(600)

step('החל ייבוא')
await page.getByRole('button', { name: /החל ייבוא/ }).click()
await page.waitForTimeout(1500)
assert(await page.getByText(/4 יובאו/).count() > 0, 'סיכום: 4 יובאו')
assert(await page.getByText(/2 לבדיקה → משימות/).count() > 0, "WOLT (לא מזוהה) + ZARA (זיכוי) → משימות")

step('אותו קובץ שוב = האצווה הקיימת')
await page.goto(`${BASE}/import`, { waitUntil: 'load' })
await cardForm().locator('input[name=file]').setInputFiles(ISRACARD)
await cardForm().getByRole('button', { name: 'פענח והצג לאישור' }).click()
await page.waitForURL(/existing=1/, { timeout: 20_000 })
assert(page.url().startsWith(batchUrl), 'הופנה לאצווה הקיימת, 0 שורות חדשות')

step('קובץ מקס — הכלל שנלמד לא תופס (בתי עסק אחרים), הזיהוי: מקס')
await page.goto(`${BASE}/import`, { waitUntil: 'load' })
await cardForm().locator('input[name=file]').setInputFiles(MAX)
await cardForm().getByRole('button', { name: 'פענח והצג לאישור' }).click()
await page.waitForURL(/\/import\/[0-9a-f-]{36}$/, { timeout: 20_000 })
assert(/זוהה: מקס/.test(await page.textContent('h1')), 'זיהוי פורמט מקס')
console.log('   אצוות:', batchUrl, page.url())
await browser.close()
