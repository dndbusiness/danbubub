/**
 * בדיקת קצה-לקצה לשלב 7 — נדל"ן ופרייבט:
 *   PIN → רווח לחלוקה → 33/33/33 → רישום משיכה → סטייה מהיעד →
 *   "החלק שלי" של שותף בודד (קריטריון §9: "אביב ויוני רואים את חלקם") →
 *   מסך 9: סימון הכנסת פרייבט כהתקבלה והחלוקה דן/ניסים.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e-partners.mjs
 *
 * הסקריפט זורע פעילות נדל"ן זמנית (מסומנת "E2E") כי בקובץ האמיתי אין עדיין
 * תנועות נדל"ן, ומבטל אותה בסוף ב-soft delete (§11.4).
 */
import { chromium } from 'playwright'
import { unlockGate } from './lib/gate.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const PIN = process.env.E2E_PIN ?? '4321'
const TAG = 'E2E נדל״ן'

let url = process.env.DATABASE_URL
if (!url && existsSync('.env.local')) url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1 })

const step = (s) => console.log(`→ ${s}`)
// זורק ולא process.exit — אחרת ה-finally לא רץ ונתוני הבדיקה נשארים ב-DB.
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }

// ── קוד גישה לשני האזורים המוגנים (§6) ─────────────────────────────────────
for (const area of ['partners', 'private']) {
  execFileSync('node', ['scripts/set-pin.mjs', area, PIN], { stdio: 'ignore' })
}

// ── זריעת פעילות נדל"ן זמנית ───────────────────────────────────────────────
const year = String(new Date().getFullYear())
const [account] = await sql`select id from accounts where type = 'bank' and deleted_at is null limit 1`
const [category] = await sql`select id from categories where deleted_at is null limit 1`
await sql`
  insert into transactions (date_cash, account_id, amount_net, vat_mode, nature, division, category_id, certainty, deductible, description)
  values (${`${year}-02-01`}, ${account.id}, 150000, 'exempt', 'income',  'realestate', ${category.id}, 'actual', null,  ${`${TAG} — שכ"ט עסקה`}),
         (${`${year}-02-08`}, ${account.id}, -30000, 'exempt', 'expense', 'realestate', ${category.id}, 'actual', true,  ${`${TAG} — הוצאה ישירה`}),
         (${`${year}-02-09`}, ${account.id}, -12000, 'exempt', 'expense', 'realestate', ${category.id}, 'actual', false, ${`${TAG} — הוצאה לא מוכרת`})`
const partners = await sql`select id, name from partners where division = 'realestate' and active and deleted_at is null order by name`
assert(partners.length === 3, `שלושה שותפי נדל"ן (${partners.length})`)

// מצב הפרייבט לפני הבדיקה — הבדיקה מסמנת שורה כ"התקבלה" ומחזירה אותה כמו שהייתה.
const privateBefore = await sql`select id, status, received_date from private_income where deleted_at is null`

const cleanup = async () => {
  await sql`update transactions set deleted_at = now() where description like ${`${TAG}%`} and deleted_at is null`
  await sql`update partner_draws set deleted_at = now() where note like ${`${TAG}%`} and deleted_at is null`
  for (const r of privateBefore) {
    await sql`update private_income set status = ${r.status}, received_date = ${r.received_date} where id = ${r.id}`
  }
  await sql.end()
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
await unlockGate(page, BASE)

async function unlock() {
  const gate = page.getByRole('button', { name: /הזן קוד|פתח שוב/ })
  if (await gate.count()) {
    await gate.click()
    await page.locator('input[inputmode=numeric]').fill(PIN)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
  }
}

try {
  step('מסך 8 — אזור מוגן')
  await page.goto(`${BASE}/partners?year=${year}`, { waitUntil: 'load' })
  assert(await page.getByText(/אזור מוגן/).count() > 0, 'המסך נעול עד להזנת קוד (§6)')
  await unlock()
  assert(await page.getByText(/פתוח ·/).count() > 0, 'נפתח עם הקוד')

  step('רווח לחלוקה ו-33/33/33')
  const profitCard = page.getByText(`רווח לחלוקה ${year}`).first()
  assert(await profitCard.count() > 0, 'קוביית רווח לחלוקה מוצגת')
  // 150,000 − 30,000 = 120,000 (הלא-מוכרת לא נספרת, §3.5)
  assert(await page.getByText('120,000').first().count() > 0, 'רווח לחלוקה 120,000 — ההוצאה הלא-מוכרת לא נספרה')
  assert(await page.getByText('40,000').first().count() > 0, 'היעד לכל שותף 40,000 (120,000 ÷ 3)')

  step('רישום משיכה לשותף הראשון')
  await page.getByRole('button', { name: /משיכה חדשה/ }).click()
  await page.waitForTimeout(500)
  await page.locator('select[name=partner_id]').selectOption({ label: partners[0].name })
  await page.locator('input[name=date]').fill(`${year}-03-01`)
  await page.locator('input[name=amount]').fill('55000')
  await page.locator('select[name=type]').selectOption('management_fee')
  await page.locator('textarea[name=note]').fill(`${TAG} — משיכה`)
  await page.getByRole('button', { name: 'רשום' }).click()
  await page.waitForTimeout(2500)

  step('הסטייה מחושבת ומוצגת')
  await page.goto(`${BASE}/partners?year=${year}`, { waitUntil: 'load' })
  await unlock()
  assert(await page.getByText('משך יותר').count() > 0, `${partners[0].name} משך מעבר ליעד — מסומן`)
  assert(await page.getByText('משך פחות').count() >= 1, 'מי שלא משך מסומן "משך פחות"')
  assert(await page.getByText('15,000').first().count() > 0, 'הסטייה 55,000 − 40,000 = 15,000')

  step('חו״ז בעלים לא נספר כמשיכה')
  await page.getByRole('button', { name: /משיכה חדשה/ }).click()
  await page.waitForTimeout(500)
  await page.locator('select[name=partner_id]').selectOption({ label: partners[0].name })
  await page.locator('input[name=date]').fill(`${year}-03-05`)
  await page.locator('input[name=amount]').fill('9000')
  await page.locator('select[name=type]').selectOption('owner_loan')
  await page.locator('textarea[name=note]').fill(`${TAG} — הלוואת בעלים`)
  await page.getByRole('button', { name: 'רשום' }).click()
  await page.waitForTimeout(2500)
  await page.goto(`${BASE}/partners?year=${year}`, { waitUntil: 'load' })
  await unlock()
  assert(await page.getByText('15,000').first().count() > 0, 'הסטייה נשארה 15,000 — הלוואת הבעלים לא נספרה כמשיכה')
  assert(await page.getByText('9,000').first().count() > 0, 'החו״ז מוצג בנפרד')

  step('קריטריון שלב 7 — כל שותף רואה את חלקו')
  const other = partners[1]
  await page.goto(`${BASE}/partners/${other.id}?year=${year}`, { waitUntil: 'load' })
  await unlock()
  assert((await page.textContent('h1'))?.includes(other.name), `הכותרת: החלק של ${other.name}`)
  assert(await page.getByText('היעד שלי').count() > 0, 'קוביית "היעד שלי"')
  assert(await page.getByText('נשאר לי למשוך').count() > 0, 'קוביית "נשאר לי למשוך"')
  assert(await page.getByText('40,000').first().count() > 0, 'היעד שלו 40,000')
  assert(await page.getByText('55,000').count() === 0, 'המשיכה של השותף האחר לא מוצגת לו')

  step('מסך 9 — פרייבט')
  await page.goto(`${BASE}/private`, { waitUntil: 'load' })
  assert(await page.getByText(/אזור מוגן/).count() > 0, 'גם פרייבט נעול (§6)')
  await unlock()
  const rowCount = await page.locator('table').first().locator('tbody tr').count()
  assert(rowCount > 0, `${rowCount} שורות פרייבט בטבלה הראשית`)
  assert(await page.getByText('החלק של דן').count() > 0, 'חלוקה דן/ניסים מוצגת')

  step('סימון "התקבל" מעביר מצפוי לפועל')
  const firstRow = page.locator('tbody tr').first()
  const before = await page.getByText('צפוי', { exact: false }).count()
  await firstRow.getByRole('button').first().click()
  await page.waitForTimeout(600)
  await page.locator('input[name=date]').fill(`${year}-09-15`)
  await page.getByRole('button', { name: 'סמן שהתקבל' }).click()
  await page.waitForTimeout(2500)
  assert(await page.getByText(/התקבל/).count() > 0, 'השורה סומנה כהתקבלה')
  assert(before > 0, 'היו שורות צפויות לפני הסימון')

  console.log('\n✓ שלב 7 עובר מקצה לקצה.')
} catch (e) {
  process.exitCode = 1
  if (!/^✗/.test(String(e?.message))) console.error(String(e?.message ?? e))
} finally {
  await browser.close()
  await cleanup()
  console.log('   (נתוני הבדיקה בוטלו ב-soft delete)')
}
