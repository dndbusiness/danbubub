/**
 * מתחרים וסקירה שיווקית (דן 22/11): + מתחרה (דף פייסבוק) → 📢 קישור למודעות הפעילות בספריית המודעות → שני עדכונים → מגמה (▲)
 * → הנתונים לסקירה (המספרים שלנו + המתחרים) → הסרה. מחזיר את ההגדרות כמו שהיו. CHROMIUM=<נתיב>
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept())
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
let before
const snap = async (ads, fol, note) => { await page.locator('[data-compsnap]').first().click(); await page.waitForSelector('.drawer'); await page.fill('#d_ads', String(ads)); await page.fill('#d_followers', String(fol)); await page.fill('textarea[name="note"]', note); await page.click('#dsave'); await page.waitForSelector('.drawer', { state: 'detached' }) }
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  before = await page.evaluate(() => JSON.parse(JSON.stringify(S.settings.competitors || null)))
  await page.evaluate(() => write('settings/main', { competitors: [] }, 'update'))
  await page.evaluate(() => { S.f.mktDiv = 'finance'; S.f.mkt = 'compete'; go('marketing') }); await page.waitForSelector('#mktReview')

  step('+ מתחרה עם דף פייסבוק')
  await page.click('[data-compnew]'); await page.waitForSelector('.drawer')
  await page.fill('#d_name', 'מתחרה Test משכנתאות'); await page.selectOption('#d_area', 'רכב'); await page.fill('#d_fb', 'https://www.facebook.com/profile.php?id=100012345678901'); await page.fill('textarea[name="notes"]', 'מבטיחים אישור תוך 24 שעות')
  await page.click('#dsave'); await page.waitForFunction(() => compList().length === 1)
  const href = await page.locator('a', { hasText: '📢 מודעות' }).getAttribute('href')
  assert(href.includes('country=IL') && href.includes('view_all_page_id=100012345678901'), '📢 = המודעות הפעילות של הדף בספריית המודעות (ישראל)')
  assert(await page.locator('h3.sec', { hasText: '🚗 הלוואות כנגד רכב' }).count() === 1, 'מקובץ לפי תחום')

  step('שני עדכונים → מגמה')
  await snap(12, 5400, 'סרטוני לקוחות, "בלי בדיקת BDI"'); await page.waitForTimeout(300); await snap(19, 5600, 'הוסיפו קמפיין רכב')
  await page.waitForFunction(() => (compList()[0].snaps || []).length === 2)
  await page.waitForTimeout(500); const row = await page.locator('tr', { hasText: 'מתחרה Test משכנתאות' }).textContent()
  assert(/19\s*▲ 7/.test(row) && /5,600\s*▲ 200/.test(row), 'מודעות 19 ▲7 · עוקבים 5,600 ▲200')
  assert(/אחרון: הוסיפו קמפיין רכב/.test(row), 'מה ראינו — בשורה')

  step('הנתונים לסקירה')
  const pr = await page.evaluate(() => mktReviewPrompt('finance'))
  assert(/מתחרה Test משכנתאות/.test(pr) && /19 מודעות/.test(pr) && /90 יום/.test(pr) && /בכפוף לאישור הגוף המממן/.test(pr), 'הסקירה מקבלת את המתחרים, העדכונים והמספרים שלנו')
  assert(await page.locator('[data-mktreview="finance"]').count() === 1, 'כפתור "צור סקירה"')

  step('הסרה')
  await page.click('[data-compdel]'); await page.waitForFunction(() => compList().length === 0)
  assert(true, 'הוסר (נשאר בהגדרות כמחוק)')
  assert(!errs.length, 'אין שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהכל עבר ✓')
} finally {
  await page.evaluate((v) => write('settings/main', { competitors: v }, 'update'), before ?? null).catch(() => {})
  await b.close()
}
