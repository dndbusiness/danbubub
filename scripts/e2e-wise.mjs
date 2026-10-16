/**
 * בדיקת קצה-לקצה לשלב 8 — לידים, WISE ותחזית:
 *   ייבוא מתעניינים → זיהוי ערוץ אוטומטי → ייבוא הגשות → התיק מתקדם ל"הוגש" →
 *   מסך 14: משפך ב-₪, עלות לידים, CAC, מסקנות אוטומטיות →
 *   מסך 13: שלושה תרחישים, דריסת הנחה, דיוק היסטורי.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e-wise.mjs
 *
 * הבדיקה מייבאת קבצים סינתטיים מ-tests/fixtures/wise ומבטלת בסוף את מה שיצרה.
 */
import { chromium } from 'playwright'
import { unlockGate } from './lib/gate.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const LEADS = resolve('tests/fixtures/wise/leads-sample.csv')
const SUBS = resolve('tests/fixtures/wise/submissions-sample.csv')

let url = process.env.DATABASE_URL
if (!url && existsSync('.env.local')) url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1 })

const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }

// מצב לפני — הבדיקה מבטלת בסוף רק את מה שהיא הוסיפה.
const before = {
  leads: (await sql`select id from leads where deleted_at is null`).map((r) => r.id),
  deals: (await sql`select id from deals where deleted_at is null`).map((r) => r.id),
  subs: (await sql`select id from deal_submissions where deleted_at is null`).map((r) => r.id),
  costs: (await sql`select id from lead_costs where deleted_at is null`).map((r) => r.id),
  batches: (await sql`select id from import_batches where source = 'wise_import' and deleted_at is null`).map((r) => r.id),
}

const cleanup = async () => {
  const keep = (list) => (list.length ? list : ['00000000-0000-0000-0000-000000000000'])
  await sql`update leads set deleted_at = now() where deleted_at is null and id <> all(${keep(before.leads)}::uuid[])`
  await sql`update deal_submissions set deleted_at = now() where deleted_at is null and id <> all(${keep(before.subs)}::uuid[])`
  await sql`update lead_costs set deleted_at = now() where deleted_at is null and id <> all(${keep(before.costs)}::uuid[])`
  await sql`update deals set deleted_at = now() where deleted_at is null and id <> all(${keep(before.deals)}::uuid[])`
  await sql`update import_batches set deleted_at = now() where source = 'wise_import' and deleted_at is null and id <> all(${keep(before.batches)}::uuid[])`
  await sql.end()
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
await unlockGate(page, BASE)
const wiseForm = () => page.locator('form').filter({ has: page.locator('select[name=form_product]') })

try {
  step('ייבוא מתעניינים מ-WISE')
  await page.goto(`${BASE}/import`, { waitUntil: 'load' })
  await wiseForm().locator('input[name=file]').setInputFiles(LEADS)
  await wiseForm().getByRole('button', { name: /קלוט ייצוא/ }).click()
  await page.waitForTimeout(4000)
  const msg = await wiseForm().locator('[role=status]').textContent()
  assert(/זוהה ייצוא מתעניינים/.test(msg ?? ''), `זוהה סוג הייצוא: ${msg?.trim()}`)
  // ריצה חוזרת מחיה שורות שבוטלו בריצה קודמת — ולכן סופרים חדשים + עודכנו.
  const m = /(\d+) לידים חדשים · (\d+) עודכנו/.exec(msg ?? '')
  assert(m && Number(m[1]) + Number(m[2]) === 5, '5 לידים נקלטו: 7 שורות − 1 בלי טלפון/אימייל − 1 כפולה (dedup)')

  step('זיהוי ערוץ אוטומטי (§4.5)')
  const car = await sql`select l.*, s.name as source_name from leads l join lead_sources s on s.id = l.source_id
                        where l.email like 'car-%' and l.deleted_at is null`
  assert(car.length === 1, 'הליד מלנדינג הרכב נקלט פעם אחת (dedup)')
  assert(car[0].source_name === 'רכב-לנדינג', 'הערוץ זוהה מהאימייל — רכב-לנדינג')
  assert(car[0].product === 'vehicle_lien', 'המוצר זוהה — שעבוד רכב')
  assert(car[0].stage === 'contacted', 'השלב המתקדם מבין שתי השורות ניצח')

  step('ייבוא חוזר של אותו קובץ = 0 שורות חדשות (§11.9)')
  await page.goto(`${BASE}/import`, { waitUntil: 'load' })
  await wiseForm().locator('input[name=file]').setInputFiles(LEADS)
  await wiseForm().getByRole('button', { name: /קלוט ייצוא/ }).click()
  await page.waitForTimeout(4000)
  assert(/כבר יובא/.test((await wiseForm().locator('[role=status]').textContent()) ?? ''), 'הקובץ זוהה ככבר-יובא')
  const [{ n }] = await sql`select count(*)::int as n from leads where deleted_at is null and wise_ref is not null`
  assert(Number(n) === 5, `עדיין 5 לידים (${n})`)

  step('ייבוא הגשות לבנקים — ומה שהן עושות לתיק')
  // ההגשות משודכות לפי שם לקוח, ולכן צריך תיק בשם הזה.
  const [{ id: dealId }] = await sql`
    insert into deals (client_name, division, product, stage, fee_agreed_net, notes)
    values ('משה לוי', 'finance', 'mortgage', 'prospect', 12000, 'E2E WISE') returning id`
  await page.goto(`${BASE}/import`, { waitUntil: 'load' })
  await wiseForm().locator('input[name=file]').setInputFiles(SUBS)
  await wiseForm().getByRole('button', { name: /קלוט ייצוא/ }).click()
  await page.waitForTimeout(4000)
  const subsMsg = await wiseForm().locator('[role=status]').textContent()
  assert(/זוהה ייצוא הגשות לבנקים/.test(subsMsg ?? ''), `זוהה סוג הייצוא: ${subsMsg?.trim()}`)
  const subs = await sql`select * from deal_submissions where deal_id = ${dealId} and deleted_at is null`
  assert(subs.length === 2, `שתי ההגשות של משה לוי נקלטו (${subs.length})`)
  const [deal] = await sql`select stage from deals where id = ${dealId}`
  assert(deal.stage === 'approved_in_principle', `ההגשה שאושרה קידמה את התיק ל"מאושר עקרונית" (${deal.stage})`)

  step('מסך 14 — המשפך ב-₪')
  await page.goto(`${BASE}/leads`, { waitUntil: 'load' })
  assert(await page.getByRole('heading', { name: 'לידים והמרה' }).count() > 0, 'מסך 14 נטען')
  assert(await page.getByText('המשפך — 90 יום').count() > 0, 'המשפך מוצג')
  assert(await page.getByText('לא הוזנו עלויות').count() > 0, 'בלי עלויות — המסך אומר שאין CAC ואין ROI, ולא ממציא')

  step('השלמת עלות לידים, ואז CAC')
  await page.getByRole('button', { name: /^עלויות/ }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /עלות חדשה/ }).click()
  await page.waitForTimeout(500)
  await page.locator('input[name=amount]').fill('3000')
  await page.locator('input[name=spread_weeks]').fill('3')
  await page.getByRole('button', { name: 'שמור' }).click()
  await page.waitForTimeout(2500)
  const costRows = await sql`select count(*)::int as n from lead_costs where deleted_at is null and note like '%שבוע%'`
  assert(Number(costRows[0].n) === 3, `החבילה נפרסה ל-3 שבועות (${costRows[0].n})`)
  await page.goto(`${BASE}/leads`, { waitUntil: 'load' })
  assert(await page.getByText('לא הוזנו עלויות').count() === 0, 'אחרי הזנת העלות המסך כבר לא אומר שאין')

  step('מסך 13 — תחזית: שלושה תרחישים ודריסת הנחה')
  await page.goto(`${BASE}/forecast`, { waitUntil: 'load' })
  assert(await page.getByRole('heading', { name: 'תחזית רבעונית' }).count() > 0, 'מסך 13 נטען')
  assert(await page.getByText('ההנחות שמאחורי המספרים').count() > 0, 'ההנחות מוצגות')
  assert(await page.getByText(/מבוסס על \d+ תיקים/).count() > 0, 'המסך מצהיר על מה הוא נשען (§UIUX 1.3)')
  await page.getByRole('button', { name: 'פסימי' }).first().click()
  await page.waitForTimeout(2000)
  assert(page.url().includes('re=pessimistic'), 'התרחיש נשמר בכתובת וניתן לשיתוף')
  assert(await page.getByText('כמה לסמוך על התחזית').count() > 0, 'דיוק היסטורי מוצג (או מוסבר שאין עדיין)')

  console.log('\n✓ שלב 8 עובר מקצה לקצה.')
} catch (e) {
  process.exitCode = 1
  console.error(String(e?.message ?? e))
} finally {
  await browser.close()
  await cleanup()
  console.log('   (נתוני הבדיקה בוטלו ב-soft delete)')
}
