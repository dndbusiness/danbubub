/**
 * בדיקת קצה-לקצה לשלב 9 — תפעול, שאלות וקישורים:
 *   מסך 15: משימה חדשה → בתהליך → בוצע · משימה אוטומטית לא נמחקת ידנית ונסגרת לבד
 *   מסך 16: שאלה לשותף → תשובה מהנייד → התנועה נסגרת והתשובה נשמרת עליה
 *   מסך 17: קישור חדש
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e-ops.mjs
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const TASK = 'משימת בדיקה E2E'
const LINK = 'קישור בדיקה E2E'

let url = process.env.DATABASE_URL
if (!url && existsSync('.env.local')) url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1 })

const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }

// תנועה אמיתית שנסמן עליה שאלה ונחזיר בסוף בדיוק למה שהייתה.
const [tx] = await sql`
  select id, review_status::text as review_status, review_note, category_id
  from transactions where deleted_at is null and nature = 'expense' order by date_cash desc limit 1`
if (!tx) { console.error('אין תנועות ב-DB'); process.exit(1) }

const cleanup = async () => {
  await sql`update tasks set deleted_at = now() where title like ${`${TASK}%`} and deleted_at is null`
  await sql`update tasks set deleted_at = now() where auto_key = 'e2e_auto:1' and deleted_at is null`
  await sql`update links set deleted_at = now() where title = ${LINK} and deleted_at is null`
  await sql`
    update transactions set review_status = ${tx.review_status}::review_status, review_note = ${tx.review_note}
    where id = ${tx.id}`
  await sql.end()
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
// מובייל — מסכים 15 ו-16 הם מובייל-first (הנחיה 6).
const page = await browser.newPage({ viewport: { width: 390, height: 900 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())

try {
  step('מסך 15 — משימה חדשה מהנייד')
  await page.goto(`${BASE}/tasks`, { waitUntil: 'load' })
  await page.getByRole('button', { name: /^משימה$/ }).click()
  await page.waitForTimeout(600)
  await page.locator('input[name=title]').fill(TASK)
  await page.locator('input[name=due_date]').fill(new Date().toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'הוסף' }).click()
  await page.waitForTimeout(2500)
  await page.goto(`${BASE}/tasks`, { waitUntil: 'load' })
  const card = page.locator('div', { hasText: TASK }).last()
  assert(await page.getByText(TASK).count() > 0, 'המשימה מופיעה בתצוגת "היום"')

  step('סימון בוצע וחזרה')
  await page.getByText(TASK).first().locator('xpath=ancestor::*[contains(@class,"rounded")][1]').locator('button').first().click()
  await page.waitForTimeout(2500)
  const [done] = await sql`select status from tasks where title = ${TASK} and deleted_at is null`
  assert(done.status === 'done', `המשימה סומנה כבוצעה (${done.status})`)
  void card

  step('משימה אוטומטית לא נמחקת ידנית (ב.10)')
  await sql`
    insert into tasks (title, due_date, priority, auto_generated, auto_key, notes, tx_id)
    values (${`${TASK} — אוטומטית`}, current_date, 'normal', true, 'e2e_auto:1', 'נפתחה לבדיקה', ${tx.id})`
  await page.goto(`${BASE}/tasks`, { waitUntil: 'load' })
  const autoRow = page.getByText(`${TASK} — אוטומטית`).first()
  assert(await autoRow.count() > 0, 'המשימה האוטומטית מוצגת')
  const autoCard = autoRow.locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
  assert(await autoCard.getByTitle('בטל').count() === 0, 'אין כפתור מחיקה למשימה אוטומטית')
  assert(await page.getByText('אוטומטית').count() > 0, 'מסומנת כאוטומטית')

  step('מסך 16 — שאלה לשותף ותשובה מהנייד')
  await sql`update transactions set review_status = 'ask_nissim' where id = ${tx.id}`
  await page.goto(`${BASE}/questions`, { waitUntil: 'load' })
  assert(await page.getByText('ממתין לניסים').count() > 0, 'התור מציג את השאלה לניסים')
  await page.locator('textarea').first().fill('זו הוצאה של המשרד, מאושרת')
  await page.getByRole('button', { name: /שלח וסגור/ }).first().click()
  await page.waitForTimeout(3000)
  const [answered] = await sql`select review_status::text as review_status, review_note from transactions where id = ${tx.id}`
  assert(answered.review_status === 'ok', `התנועה נסגרה (${answered.review_status})`)
  assert(answered.review_note?.includes('תשובת ניסים'), 'התשובה נשמרה על התנועה עם מי ענה ומתי')

  step('מסך 17 — קישור חדש')
  await page.goto(`${BASE}/links`, { waitUntil: 'load' })
  await page.getByRole('button', { name: /^קישור$/ }).click()
  await page.waitForTimeout(600)
  await page.locator('input[name=title]').fill(LINK)
  await page.locator('input[name=url]').fill('https://example.com')
  await page.locator('input[name=category]').fill('מערכות')
  await page.getByRole('button', { name: 'הוסף' }).click()
  await page.waitForTimeout(2500)
  await page.goto(`${BASE}/links`, { waitUntil: 'load' })
  assert(await page.getByText(LINK).count() > 0, 'הקישור מופיע תחת הקטגוריה')

  step('סגירה אוטומטית של משימה שתנאיה נפתרו (ב.10)')
  // התנועה כבר נענתה וסווגה, ולכן המשימה עם unknown_expense עליה אמורה להיסגר.
  await sql`update tasks set auto_key = ${`unknown_expense:${tx.id}`}, status = 'open' where auto_key = 'e2e_auto:1'`
  const res = await fetch(`${BASE}/api/jobs/alerts_eval`, {
    method: 'POST',
    headers: { 'x-jobs-secret': (readFileSync('.env.local', 'utf8').match(/^JOBS_SECRET=(.+)$/m)?.[1] ?? '').trim() },
  })
  const out = await res.json()
  const [auto] = await sql`select status, notes from tasks where auto_key = ${`unknown_expense:${tx.id}`} and deleted_at is null`
  assert(auto.status === 'done', `המשימה נסגרה לבד (${auto.status})`)
  assert(auto.notes?.includes('נסגר אוטומטית'), 'הסגירה מתועדת בהערה')
  assert(out.detail?.autoClosedTasks?.closed >= 1, `הג'וב דיווח על הסגירה (${JSON.stringify(out.detail?.autoClosedTasks)})`)

  console.log('\n✓ שלב 9 עובר מקצה לקצה.')
} catch (e) {
  process.exitCode = 1
  console.error(String(e?.message ?? e))
} finally {
  await browser.close()
  await cleanup()
  console.log('   (נתוני הבדיקה בוטלו והתנועה הוחזרה למצבה)')
}
