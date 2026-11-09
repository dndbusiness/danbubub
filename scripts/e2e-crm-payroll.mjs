/**
 * שכר ב-CRM (דן 07/11): "+ עובד חדש" ×2 (תבנית נציג / שכר חודשי) → רכיבים: שעות, עמלה לסגירה, בונוס יעד, אחוז מסכום, רצפה
 * → הזנת החודש → החישוב עם הסבר לכל שורה → עריכה (הסרת רכיב) → הסרה מהשכר והחזרה → PDF לרו״ח → 390px.
 * בסוף — רשימת העובדים חוזרת למה שהייתה. מריצים מול שרת מקומי (npm start). CHROMIUM=<נתיב> · E2E_OUT=<תיקייה>
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000', OUT = process.env.E2E_OUT ?? null
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const shot = async (page, n) => { if (OUT) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: false }) } }

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept('עזב'))
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
let before = null
const card = (name) => page.locator('.grid3 > section.card', { has: page.locator('h2', { hasText: name }) })
const total = async (name) => (await card(name).locator('tfoot').innerText()).replace(/[^\d.-]/g, '')
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.waitForTimeout(2000); await page.evaluate(() => { const l = document.getElementById('layer'); if (l) l.innerHTML = ''; document.getElementById('callpop')?.remove() })
  before = await page.evaluate(() => JSON.parse(JSON.stringify((S.settings.payroll || {}).employees || [])))
  await page.evaluate(() => { S.f.books = 'payroll'; go('books') }); await page.waitForSelector('[data-payemp=""]')

  step('+ עובד חדש — נציג/ה: שעתי + עמלה לסגירה + בונוס יעד, ועוד אחוז מסכום ורצפה')
  await page.click('[data-payemp=""]'); await page.waitForSelector('#pcomps .pcomp')
  assert(await page.locator('#pcomps .pcomp').count() === 3, 'תבנית הנציג פותחת 3 רכיבים ריקים (בלי מספרים ממוצאים)')
  await page.fill('#d_name', 'נציג Test-לוי')
  const rows = page.locator('#pcomps .pcomp')
  await rows.nth(0).locator('[data-cf="rate"]').fill('40'); await rows.nth(1).locator('[data-cf="rate"]').fill('300')
  await rows.nth(2).locator('[data-cf="threshold"]').fill('8'); await rows.nth(2).locator('[data-cf="bonus"]').fill('1000')
  await page.click('[data-pcadd="pct"]'); await page.waitForFunction(() => document.querySelectorAll('#pcomps .pcomp').length === 4)
  await rows.nth(3).locator('[data-cf="label"]').fill('אחוז מהשכ״ט שנגבה'); await rows.nth(3).locator('[data-cf="pct"]').fill('5')
  await page.fill('#d_floor', '6000'); await shot(page, 'pay-editor')
  await page.click('#dsave'); await page.waitForFunction(() => ((S.settings.payroll?.employees || []) || []).some((e) => e.name === 'נציג Test-לוי'))
  const E1 = await page.evaluate(() => (S.settings.payroll?.employees || []).find((e) => e.name === 'נציג Test-לוי'))
  assert(E1.components.length === 4 && E1.components[0].rate === 40 && E1.components[2].threshold === 8 && E1.components[3].pct === 5 && E1.floor === 6000 && E1.active, 'נשמר: 4 רכיבים, רצפה 6,000')

  step('+ עובד שני — שכר חודשי')
  await page.click('[data-payemp=""]'); await page.waitForSelector('#d_name'); await page.click('[data-ptpl="monthly"]')
  await page.fill('#d_name', 'נציגה Two'); await page.locator('#pcomps .pcomp').nth(0).locator('[data-cf="amount"]').fill('7000'); await page.click('#dsave')
  await page.waitForFunction(() => (S.settings.payroll?.employees || []).some((e) => e.name === 'נציגה Two'))
  await page.waitForSelector('section.card h2:has-text("נציגה Two")')
  assert(await card('נציג Test-לוי').count() === 1 && await card('נציגה Two').count() === 1, 'שני הנציגים בשכר')

  step('הזנת החודש → חישוב עם הסבר')
  const c1 = card('נציג Test-לוי')
  await c1.locator('[data-pq="hours"]').fill('160'); await c1.locator('[data-pq="hours"]').dispatchEvent('change'); await page.waitForTimeout(400)
  await card('נציג Test-לוי').locator('[data-pq="closes"]').fill('8'); await card('נציג Test-לוי').locator('[data-pq="closes"]').dispatchEvent('change'); await page.waitForTimeout(400)
  await card('נציג Test-לוי').locator('input[data-pb]').fill('20000'); await card('נציג Test-לוי').locator('input[data-pb]').dispatchEvent('change'); await page.waitForTimeout(600)
  // 160×40 + 8×300 + יעד 1000 + 5%×20000 = 6400 + 2400 + 1000 + 1000 = 10800
  assert(await total('נציג Test-לוי') === '10,800'.replace(/,/g, '') || (await total('נציג Test-לוי')).replace(/,/g, '') === '10800', 'סה״כ 10,800 (שעות + עמלות + בונוס יעד + אחוז)')
  const how = await card('נציג Test-לוי').locator('tbody').innerText()
  assert(/160 שעות × 40/.test(how) && /מתוך יעד 8 סגירות — הגיע/.test(how) && /5% × 20,000/.test(how), 'לכל שורה הסבר: "160 שעות × 40", "8 מתוך יעד 8 — הגיע", "5% × 20,000"')
  assert((await total('נציגה Two')).replace(/,/g, '') === '7000', 'נציגה Two: 7,000 חודשי')
  await shot(page, 'pay-month')

  step('עריכה: הסרת בונוס היעד → מחושב מחדש; פחות מהרצפה → השלמה')
  await card('נציג Test-לוי').locator('[data-payemp]').click(); await page.waitForSelector('#pcomps .pcomp')
  await page.locator('#pcomps .pcomp').nth(2).locator('[data-pcdel]').click(); await page.waitForFunction(() => document.querySelectorAll('#pcomps .pcomp').length === 3)
  await page.click('#dsave'); await page.waitForFunction(() => (S.settings.payroll?.employees || []).find((e) => e.name === 'נציג Test-לוי').components.length === 3)
  await page.waitForTimeout(500)
  assert((await total('נציג Test-לוי')).replace(/,/g, '') === '9800', 'בלי בונוס היעד: 9,800')
  await card('נציג Test-לוי').locator('[data-pq="hours"]').fill('20'); await card('נציג Test-לוי').locator('[data-pq="hours"]').dispatchEvent('change'); await page.waitForTimeout(600)
  // 800 + 2400 + 1000 = 4200 → השלמה 1800 → 6000
  assert((await total('נציג Test-לוי')).replace(/,/g, '') === '6000' && /השלמה לרצפה/.test(await card('נציג Test-לוי').locator('tbody').innerText()), 'מתחת לרצפה: שורת "השלמה לרצפה" → 6,000')

  step('עלות מעביד בפועל עד היום: 1,080 → אחוז מחושב ופיזור על החודש')
  await card('נציג Test-לוי').locator('summary:has-text("עלות מעביד בפועל")').click()
  await card('נציג Test-לוי').locator('input[id^="empact_"]').fill('1080'); await card('נציג Test-לוי').locator('[data-empfix]').click(); await page.waitForSelector('#dsave')
  const prev = await page.locator('.drawer').innerText()
  assert(/18%/.test(prev) && /1,080/.test(prev), 'תצוגה מקדימה לפני שמירה: 1,080 על ברוטו 6,000 = 18%')
  await page.click('#dsave'); await page.waitForTimeout(800)
  const E = await page.evaluate(() => { const e = (S.settings.payroll?.employees || []).find((k) => k.name === 'נציג Test-לוי'), x = payDoc(S.f.payMonth || payMonthDefault(), e.key); return { pct: e.employerPct, amt: x.employerAmt, total: payCalc(e, x).total } })
  assert(E.pct === 18 && E.amt === 1080 && E.total === 7080, 'נשמר: 18% לחודשים הבאים, ובחודש הזה עלות מעביד 1,080 → סה״כ 7,080')

  step('בדיקת כפילויות: הוצאת קמפיין רכב פעמיים + עלות מעביד גם כהוצאה')
  const M = await page.evaluate(() => S.f.payMonth || payMonthDefault())
  await page.evaluate(async (m) => { const t = (id, date, net, cp, cat) => write('transactions/' + id, { id, nature: 'expense', division: 'finance', date, net: -net, gross: -net * 1.18, counterparty: cp, category: cat, deductible: true, source: 'e2e', createdAt: stamp(), updatedAt: stamp() })
    await t('e2edup1', m + '-20', 3768, 'פייסבוק הלוואות רכב E2E', 'שיווק'); await t('e2edup2', m + '-22', 3768, 'פייסבוק הלוואות רכב E2E', 'שיווק'); await t('e2edup3', m + '-25', 1080, 'ביטוח לאומי מעסיק E2E', 'מיסים') }, M)
  await page.waitForFunction(() => S.transactions.has('e2edup3')); await page.evaluate(() => render()); await page.waitForTimeout(400)
  const F = await page.evaluate(() => dupFindings().map((f) => f.kind + ':' + (f.b ? f.b.id : f.a.id)))
  assert(F.includes('tx:e2edup2') && F.includes('emp:e2edup3'), 'נמצאו: "פייסבוק הלוואות רכב" נרשם פעמיים · עלות מעביד גם במסך השכר וגם כהוצאה')
  assert(await page.locator('#dupcard').count() === 1, 'במסך השכר: כרטיס "בדיקת כפילויות"')
  await page.evaluate(() => { S.f.money = 'settle'; go('money') }); await page.waitForSelector('[data-dupdel="e2edup2"]')
  await page.click('[data-dupdel="e2edup2"]'); await page.waitForFunction(() => !!S.transactions.get('e2edup2').deletedAt)
  const empKey = await page.evaluate(() => (S.settings.payroll?.employees || []).find((k) => k.name === 'נציג Test-לוי').key)
  await page.click(`[data-empzero="${M}|${empKey}"]`); await page.waitForTimeout(600)
  const F2 = await page.evaluate(() => dupFindings().map((f) => f.kind + ':' + (f.b ? f.b.id : f.a.id)))
  assert(!F2.includes('tx:e2edup2') && !F2.includes('emp:e2edup3'), '"מחק את השנייה" ו"השאר רק את ההוצאה" — הכפילויות נעלמו')
  await page.evaluate(() => { S.f.books = 'payroll'; go('books') }); await page.waitForSelector('.grid3')

  step('הסרה מהשכר והחזרה')
  await card('נציגה Two').locator('[data-payemp]').click(); await page.waitForSelector('[data-payremove]'); await page.click('[data-payremove]')
  await page.waitForFunction(() => (S.settings.payroll?.employees || []).find((e) => e.name === 'נציגה Two').active === false)
  await page.waitForTimeout(400)
  assert(await card('נציגה Two').count() === 0 && /עובדים שהוסרו מהשכר/.test(await page.textContent('main') || await page.textContent('body')), 'הוסרה — עוברת ל"עובדים שהוסרו" (הסיבה נשמרה)')
  await page.click('summary:has-text("עובדים שהוסרו")'); await page.click('[data-payback]'); await page.waitForSelector('section.card h2:has-text("נציגה Two")')
  assert(true, 'הוחזרה לשכר')

  step('PDF לרו״ח')
  await page.click('[data-act="payPdf"]'); await page.waitForTimeout(2500)

  step('נייד 390px')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => render()); await page.waitForTimeout(500); await shot(page, 'pay-390')
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(ovf <= 1, 'בלי גלילה לרוחב ב-390px (' + ovf + ')')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nשכר ב-CRM — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 } finally {
  await page.evaluate(async () => { for (const id of ['e2edup1', 'e2edup2', 'e2edup3']) if (S.transactions.has(id)) await write('transactions/' + id, { deletedAt: stamp() }, 'update') }).catch(() => {})
  if (before) await page.evaluate(async (emps) => { const m = S.f.payMonth || payMonthDefault(); for (const e of (S.settings.payroll?.employees || []).filter((x) => !emps.some((y) => y.key === x.key))) { const id = m + '__' + e.key; if (S.payroll.has(id)) await write('payroll/' + id, { deletedAt: stamp() }, 'update') }
    await write('settings/main', { payroll: { ...(S.settings.payroll || {}), employees: emps } }, 'update') }, before).catch((e) => console.error('ניקוי:', e.message))
  await b.close()
}
