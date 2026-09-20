/**
 * בדיקת קצה-לקצה לשלב 6 — בנק + חשבונית ירוקה + מע"מ + פערים:
 *   דף בנק → אימות יתרה → שידוך לתנועות קיימות → החלה → ייצוא חשבונית ירוקה →
 *   מסך 10 (מע"מ) → מסך 12 (פערים) → "שלח לרו"ח" = קריטריון הסיום של שלב 6.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e-gaps.mjs
 */
import { chromium } from 'playwright'
import { unlockGate } from './lib/gate.mjs'
import { resolve } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const BANK = resolve('tests/fixtures/bank/hapoalim-e2e.csv')
const GI = resolve('tests/fixtures/greeninvoice/expenses-e2e.csv')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
await unlockGate(page, BASE)
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); process.exit(1) } console.log(`✓ ${m}`) }
const giForm = () => page.locator('form').filter({ has: page.locator('select[name=direction]') })

step('העלאת דף בנק')
await page.goto(`${BASE}/import`, { waitUntil: 'load' })
const bankForm = page.locator('form').filter({ has: page.locator('select[name=account_id]') }).filter({ hasNot: page.locator('input[name=billing_date]') })
await bankForm.locator('input[name=file]').setInputFiles(BANK)
await bankForm.getByRole('button', { name: /פענח והצג לאישור/ }).click()
await page.waitForURL(/\/import\/[0-9a-f-]{36}/, { timeout: 30_000 })
const batchUrl = page.url()
assert(/הפועלים/.test(await page.textContent('h1')), 'זיהוי פורמט בנק הפועלים בכותרת')

step('אימות היתרה הרצה (§4.2)')
assert(await page.getByText('היתרה מסתדרת').count() > 0, 'פתיחה + תנועות = סגירה')

step('שידוך לתנועות שכבר במערכת')
const matchedKpi = await page.getByText('שודכו לתנועה קיימת').count()
assert(matchedKpi > 0, 'קוביית "שודכו לתנועה קיימת" מוצגת')
const matchedPills = await page.getByText('שודך', { exact: true }).count()
assert(matchedPills >= 3, `לפחות 3 שורות שודכו לתנועות קיימות (${matchedPills})`)

step('החלת דף הבנק')
const applyBtn = page.getByRole('button', { name: /החל ייבוא/ })
if (await applyBtn.count()) {
  await applyBtn.click()
  await page.waitForTimeout(3000)
  await page.goto(batchUrl, { waitUntil: 'load' })
  const err = await page.locator('p[role=alert]').first().textContent().catch(() => null)
  assert(!err?.trim(), `אין שגיאה בהחלה${err ? `: ${err}` : ''}`)
} else {
  console.log('… האצווה כבר הוחלה בריצה קודמת')
}
assert(await page.getByText(/תנועות חדשות/).count() > 0, 'סיכום ההחלה מוצג')
assert(await page.getByRole('button', { name: /החל ייבוא/ }).count() === 0, 'האצווה כבר לא ניתנת להחלה חוזרת')

step('אותו קובץ שוב = 0 שורות חדשות (§11.9)')
await page.goto(`${BASE}/import`, { waitUntil: 'load' })
const bankForm2 = page.locator('form').filter({ has: page.locator('select[name=account_id]') }).filter({ hasNot: page.locator('input[name=billing_date]') })
await bankForm2.locator('input[name=file]').setInputFiles(BANK)
await bankForm2.getByRole('button', { name: /פענח והצג לאישור/ }).click()
await page.waitForURL(/existing=1/, { timeout: 30_000 })
assert(page.url().startsWith(batchUrl), 'הופנה לאצווה הקיימת')

step('קליטת ייצוא חשבונית ירוקה')
await page.goto(`${BASE}/import`, { waitUntil: 'load' })
const gi = giForm()
await gi.locator('input[name=file]').setInputFiles(GI)
await gi.getByRole('button', { name: /קלוט מסמכים/ }).click()
await page.waitForTimeout(3000)
const giMsg = await gi.locator('[role=status]').textContent()
assert(/מסמכים נקלטו|כבר יובא/.test(giMsg ?? ''), `סיכום הקליטה: ${giMsg?.trim()}`)
assert(/ממתינים להכרעת שותף/.test(giMsg ?? '') || /כבר יובא/.test(giMsg ?? ''), 'חשבונית של ישות שותף סומנה להכרעה (§4.3)')

step('מסך 10 — מע"מ')
await page.goto(`${BASE}/vat`, { waitUntil: 'load' })
assert(await page.getByRole('heading', { name: 'מע״מ' }).count() > 0, 'מסך 10 נטען')
assert(await page.getByText('תשומות ללא חשבונית — 18 חודשים').count() > 0, 'תשומות שאין להן חשבונית מוצגות בנפרד')

step('מסך 12 — פערים')
await page.goto(`${BASE}/gaps`, { waitUntil: 'load' })
assert(await page.getByRole('heading', { name: 'פערי חשבוניות' }).count() > 0, 'מסך 12 נטען')
const monthRows = await page.locator('tbody tr').count()
assert(monthRows === 12, `טבלת 12 חודשים (${monthRows})`)

step('סימון "לא נדרשת חשבונית" על עמלת הבנק')
await page.getByRole('button', { name: /^שורות/ }).click()
await page.waitForTimeout(500)
const feeRow = page.locator('tbody tr', { hasText: 'עמלות בנק' }).first()
if (await feeRow.count()) {
  await feeRow.getByRole('button').first().click()
  await page.waitForTimeout(2000)
  assert(await page.getByText('סומן שלא נדרשת חשבונית').count() > 0, 'עמלת הבנק ירדה מרשימת הפערים')
} else {
  console.log('… אין שורת "עמלות בנק" פתוחה — כנראה סומנה בריצה קודמת')
}

step('הכרעת חשבונית של ישות שותף')
await page.goto(`${BASE}/gaps`, { waitUntil: 'load' })
await page.getByRole('button', { name: /חשבוניות שותפים לאישור/ }).click()
await page.waitForTimeout(500)
const drawBtn = page.getByRole('button', { name: /משיכה/ }).first()
if (await drawBtn.count()) {
  await drawBtn.click()
  await page.waitForTimeout(2000)
  assert(await page.getByText('סווג כמשיכה').count() > 0, 'חשבונית ד&ד סווגה כמשיכה ולא כהוצאה (שאלה #15)')
} else {
  console.log('… אין חשבונית שותף ממתינה — כנראה הוכרעה בריצה קודמת')
}

step('קריטריון שלב 6 — דוח פערים 12 חודשים נשלח לרו"ח')
await page.goto(`${BASE}/gaps`, { waitUntil: 'load' })
await page.getByRole('button', { name: /שלח לרו״ח/ }).click()
// הפקת ה-PDF לוקחת כמה שניות; ההודעה נעלמת אחרי 10 שניות, ולכן ממתינים לה ולא לזמן קבוע.
const statusEl = page.getByText(/הדוח נשלח|ממתין ב-outbox|כבר ממתינה במשלוח|אין כתובת רו״ח/)
await statusEl.waitFor({ state: 'visible', timeout: 60_000 })
const status = await statusEl.first().textContent()
const err = await page.locator('p[role=alert]').first().textContent().catch(() => null)
assert(!err?.trim(), `אין שגיאה בשליחה${err ? `: ${err}` : ''}`)
assert(/נשלח|ממתין|הופק/.test(status ?? ''), `הדוח הופק ונשלח: ${status?.trim()}`)
await page.reload({ waitUntil: 'load' })
assert(await page.getByText(/נשלח לאחרונה/).count() > 0, 'ההפקה נרשמה ב-report_runs (ומסמנת ✓ בצ׳קליסט סגירת החודש)')

await browser.close()
console.log('\n✓ שלב 6 עובר מקצה לקצה.')
