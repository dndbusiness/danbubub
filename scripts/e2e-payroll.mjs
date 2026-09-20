/**
 * בדיקת קצה-לקצה לשלב 8b — שכר (SPEC §3.9, מסך 19):
 *   עובד + הסכם → הזנת קלט → תחשיב עם הסבר לכל שורה → אישור (תצלום) →
 *   חודש שאושר לא נערך → דוח לרו"ח (HTML + CSV) → סימון תשלום → תנועה בחשבון.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e-payroll.mjs
 *
 * הבדיקה מייצרת עובד זמני ומבטלת אותו בסוף (§11.4).
 */
import { chromium } from 'playwright'
import { unlockGate } from './lib/gate.mjs'
import { readFileSync, existsSync } from 'node:fs'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const PERIOD = process.env.E2E_PERIOD ?? new Date().toISOString().slice(0, 7)
const NAME = 'בדיקת שכר E2E'

let url = process.env.DATABASE_URL
if (!url && existsSync('.env.local')) url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1 })

const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }

const cleanup = async () => {
  const ids = (await sql`select id from employees where name = ${NAME} and deleted_at is null`).map((r) => r.id)
  if (ids.length) {
    const txIds = (await sql`select paid_tx_id from payroll_months where employee_id = any(${ids}::uuid[]) and paid_tx_id is not null`).map((r) => r.paid_tx_id)
    if (txIds.length) await sql`update transactions set deleted_at = now() where id = any(${txIds}::uuid[])`
    await sql`update payroll_months set deleted_at = now() where employee_id = any(${ids}::uuid[])`
    await sql`update employment_terms set deleted_at = now() where employee_id = any(${ids}::uuid[])`
    await sql`update employees set deleted_at = now(), active = false where id = any(${ids}::uuid[])`
  }
  await sql`update tasks set deleted_at = now() where auto_key like ${`payroll_%:${PERIOD}`} and deleted_at is null`
  await sql.end()
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
await unlockGate(page, BASE)
const row = () => page.locator('tbody tr', { hasText: NAME })

try {
  step('עובד חדש + הסכם עם רכיב בונוס')
  await page.goto(`${BASE}/payroll?period=${PERIOD}`, { waitUntil: 'load' })
  await page.getByRole('button', { name: /^עובד$/ }).click()
  await page.waitForTimeout(500)
  await page.locator('input[name=name]').fill(NAME)
  await page.locator('input[name=start_date]').fill(`${PERIOD}-01`)
  await page.locator('input[name=finance_pct]').fill('80')
  await page.getByRole('button', { name: 'הוסף' }).click()
  await page.waitForTimeout(2500)

  await page.goto(`${BASE}/payroll?period=${PERIOD}`, { waitUntil: 'load' })
  await page.getByRole('button', { name: /^הסכם$/ }).click()
  await page.waitForTimeout(500)
  await page.locator('select[name=employee_id]').selectOption({ label: NAME })
  await page.locator('input[name=valid_from]').fill(`${PERIOD}-01`)
  await page.locator('input[name=monthly_base]').fill('10000')
  await page.locator('textarea[name=components]').fill('[{"name":"פגישות","type":"per_unit","rate":150,"unit":"meetings"}]')
  await page.getByRole('button', { name: 'שמור הסכם' }).click()
  await page.waitForTimeout(2500)

  step('קלט חסר נאמר במפורש ולא מוצג כ-0')
  await page.goto(`${BASE}/payroll?period=${PERIOD}`, { waitUntil: 'load' })
  assert(await row().getByText(/חסר: פגישות/).count() > 0, 'המסך אומר איזה קלט חסר')

  step('הזנת 12 פגישות')
  await row().locator('input').nth(1).fill('12')
  await row().locator('input').nth(1).blur()
  await page.waitForTimeout(2500)
  await page.goto(`${BASE}/payroll?period=${PERIOD}`, { waitUntil: 'load' })

  step('התחשיב מוצג עם ההסבר לכל שורה (§3.9)')
  await row().locator('button[title="הצג את התחשיב"]').click()
  await page.waitForTimeout(800)
  const drawer = page.locator('[role=dialog]')
  assert(await drawer.getByText('בסיס חודשי').count() > 0, 'הבסיס מוצג עם ההסבר')
  assert(await drawer.getByText(/12 פגישות/).count() > 0, 'הרכיב מוצג כ"12 פגישות × 150 ₪"')
  // החלוקה היא של **עלות המעביד** (14,396), לא של הברוטו: 80% = 11,516.80.
  assert(await drawer.getByText(/11,516/).count() > 0, 'החלוקה 80/20 של עלות המעביד מוצגת (§1.2)')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  const [before] = await sql`select gross_total, status from payroll_months m join employees e on e.id = m.employee_id where e.name = ${NAME} and e.deleted_at is null and m.deleted_at is null and m.period = ${PERIOD}`
  assert(!before?.gross_total, 'לפני אישור אין תצלום שמור — רק קלט')

  step('אישור — התחשיב נשמר כתצלום')
  await page.goto(`${BASE}/payroll?period=${PERIOD}`, { waitUntil: 'load' })
  await row().locator('button[title="אשר את העובד הזה"]').click()
  await page.waitForTimeout(3000)
  const approveErr = await page.locator('p[role=alert]').first().textContent().catch(() => null)
  assert(!approveErr?.trim(), `אין שגיאה באישור${approveErr ? `: ${approveErr}` : ''}`)
  const [after] = await sql`select gross_total, employer_cost_est, status, computed from payroll_months m join employees e on e.id = m.employee_id where e.name = ${NAME} and e.deleted_at is null and m.deleted_at is null and m.period = ${PERIOD}`
  assert(after.status === 'approved', `הסטטוס אושר (${after.status})`)
  assert(Number(after.gross_total) === 11800, `ברוטו 10,000 + 12×150 = 11,800 (${after.gross_total})`)
  assert(Number(after.employer_cost_est) === 14396, `עלות מעביד 11,800 × 1.22 = 14,396 (${after.employer_cost_est})`)
  assert(after.computed?.components?.[0]?.explanation?.includes('12'), 'ההסבר נשמר בתוך התצלום')

  step('חודש שאושר לא נערך (§3.9)')
  await page.goto(`${BASE}/payroll?period=${PERIOD}`, { waitUntil: 'load' })
  assert(await row().locator('input:disabled').count() >= 4, 'שדות הקלט ננעלו')

  step('הדוח לרו"ח — אותה פונקציה, HTML ו-CSV')
  const html = await page.request.get(`${BASE}/reports/payroll/${PERIOD}`)
  const body = await html.text()
  assert(html.ok(), 'הדוח נוצר')
  assert(body.includes(NAME) && body.includes('12 פגישות'), 'הדוח נושא את ההסבר לכל רכיב')
  const csv = await page.request.get(`${BASE}/reports/payroll/${PERIOD}?csv=1`)
  const csvText = await csv.text()
  assert(csv.ok() && csvText.includes(NAME), 'קובץ ה-CSV לאקסל של הרו"ח נוצר')
  assert(csvText.startsWith('﻿'), 'ה-CSV עם BOM — נפתח באקסל בעברית')

  step('סימון תשלום → תנועה בחשבון (החיבור ל-P&L ולתזרים)')
  await page.goto(`${BASE}/payroll?period=${PERIOD}`, { waitUntil: 'load' })
  await row().locator('button[title="סמן ששולם"]').click()
  await page.waitForTimeout(1000)
  const payDrawer = page.locator('[role=dialog]')
  await payDrawer.locator('input[name=date]').fill(`${PERIOD}-10`)
  await payDrawer.getByRole('button', { name: 'סמן ששולם' }).click()
  await page.waitForTimeout(3500)
  const payErr = await page.locator('p[role=alert]').first().textContent().catch(() => null)
  assert(!payErr?.trim(), `אין שגיאה בסימון התשלום${payErr ? `: ${payErr}` : ''}`)
  const [paid] = await sql`
    select m.status, t.amount_net, t.division, t.division_split
    from payroll_months m join employees e on e.id = m.employee_id
    left join transactions t on t.id = m.paid_tx_id
    where e.name = ${NAME} and e.deleted_at is null and m.deleted_at is null and m.period = ${PERIOD}`
  assert(paid.status === 'paid', `הסטטוס שולם (${paid.status})`)
  assert(Number(paid.amount_net) === -14396, `נרשמה תנועה על עלות המעביד (${paid.amount_net})`)
  assert(paid.division === 'shared' && Number(paid.division_split.finance) === 0.8, 'התנועה נושאת את מפתח החלוקה של העובד (§1.2)')

  console.log('\n✓ שלב 8b עובר מקצה לקצה.')
} catch (e) {
  process.exitCode = 1
  console.error(String(e?.message ?? e))
} finally {
  await browser.close()
  await cleanup()
  console.log('   (נתוני הבדיקה בוטלו ב-soft delete)')
}
