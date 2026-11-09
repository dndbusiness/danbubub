/**
 * סדר הגשה לכל גוף (דן 09/11): כרטיס לקוח ← ניתוחים וכלים ← "📋 הגשה לגוף" → בחירת גוף → השדות בסדר של טופס הגוף, עם הערכים מהכרטיס
 * ומ"הכר את הלקוח" → לחיצה על ערך מעתיקה · "העתק הבא" לפי הסדר · "העתק את השלב" · חסר בתיק מסומן · שלב שחוזר לכל לווה.
 * נתונים סינתטיים; מנקה אחריו. CHROMIUM=<נתיב> E2E_OUT=<תיקייה>
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
const CID = 'e2e-submit-' + Date.now().toString(36)

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const clip = () => page.evaluate(() => navigator.clipboard.readText())
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.waitForTimeout(2000); await page.evaluate(() => { const l = document.getElementById('layer'); if (l) l.innerHTML = ''; document.getElementById('callpop')?.remove() })
  await page.evaluate(async (id) => {
    await write('clients/' + id, { id, name: 'דנה כהן-לוי', phone: '052-123-4567', email: 'dana@example.com', idNumber: '000000018', birthDate: '1985-03-07', address: 'הרצל 12 דירה 4, רמת גן 5250000', spouseName: 'Avi Levi', spouseId: '000000026', spousePhone: '0541112233',
      division: 'finance', status: 'open', stage: 'signed_collecting_docs', product: 'mortgage', submissions: [{ bank: 'פריסבי' }], createdAt: stamp(), updatedAt: stamp() })
    await write('intakes/' + id, { id, clientId: id, kind: 'mortgage', borrowers: [{ name: 'דנה כהן-לוי', emp: 'salaried', income: 14000, seniority: 6 }, { name: 'Avi Levi', emp: 'self', income: 9000 }],
      request: { amount: 450000, years: 20, purpose: 'consolidation' }, property: { type: 'apartment', value: 2100000, isHome: 'yes' }, balMortgage: 300000, credit: { execution: false, restricted: false, checks: false, mortReturns: 0 },
      story: 'סיפור בדיקה אוטומטית', updatedAt: stamp() })
  }, CID)
  await page.waitForFunction((id) => S.clients.has(id) && S.intakes.has(id), CID)

  step('כרטיס הלקוח ← "📋 הגשה לגוף" — ברירת מחדל: הגוף שהוגש אליו (פריסבי)')
  await page.evaluate((id) => { S.f.ctool = { ...(S.f.ctool || {}), [id]: 'submit' }; go('client', id) }, CID); await page.waitForSelector('#subcard')
  assert(await page.locator('[data-subl$="|frisbee"][aria-pressed="true"]').count() === 1, 'נבחר פריסבי (מתוך ההגשות של הלקוח)')
  const txt = await page.textContent('#subcard')
  assert(/מיחזור לאיחוד חובות/.test(txt) && /450,000/.test(txt), 'מטרה ("איחוד הלוואות" → "מיחזור לאיחוד חובות" של פריסבי) וסכום')
  assert(/לווה 1 \(דנה כהן-לוי\)/.test(txt) && /לווה 2 \(Avi Levi\)/.test(txt), 'שלב "ישויות מעורבות" — פעם לכל לווה')
  assert(/07\/03\/1985/.test(txt) && /רמת גן/.test(txt) && /הרצל/.test(txt) && /0521234567/.test(txt), 'תאריך לידה, עיר, רחוב וטלפון — בפורמט של הטופס')
  assert(/שנייה/.test(txt), 'דרגת שיעבוד: יש משכנתא קיימת → "שנייה"')
  await shot(page, 'submit-frisbee')

  step('לחיצה על ערך מעתיקה · "העתק הבא" לפי הסדר')
  await page.click('#subcard [data-subcp="0"]'); assert(await clip() === 'מיחזור לאיחוד חובות', 'לחיצה על הערך הראשון — הועתק "מיחזור לאיחוד חובות"')
  await page.click('#subcard [data-subnext]'); const c1 = await clip(); await page.click('#subcard [data-subnext]'); const c2 = await clip()
  assert(c1 === 'מיחזור לאיחוד חובות' && c2 === '450000', '"העתק הבא": מטרה ← סכום (450000 בלי פסיקים)')
  await page.click('#subcard [data-substep="2"]'); const st = await clip()
  assert(/^סוג ממשכן: לווה ממשכן\nשם פרטי: דנה/.test(st), 'העתק את השלב: "שדה: ערך" בשורות, לפי הסדר')

  step('מעבר לגוף אחר — Credit 360, עוגן, מזרחי-טפחות')
  await page.click('[data-subl$="|credit360"]'); await page.waitForFunction(() => /פרטי ההלוואה/.test(document.getElementById('subcard').textContent))
  const t2 = await page.textContent('#subcard')
  assert(/פרטי לווים — לווה 2/.test(t2) && /הצהרות על הלווים/.test(t2), 'Credit 360: לווים בנפרד + הצהרות')
  await page.click('[data-subl$="|ogen"]'); await page.waitForFunction(() => /הבעלים הראשי בעסק/.test(document.getElementById('subcard').textContent))
  assert(/חובה וחסרים בתיק/.test(await page.textContent('#subcard')), 'עוגן: פרטי העסק חסרים בתיק — מסומן "חובה וחסרים"')

  await page.click('[data-subl$="|mizrahi"]'); await page.waitForFunction(() => /תכנון משכנתא/.test(document.getElementById('subcard').textContent))
  const t3 = await page.textContent('#subcard')
  assert(/כן, דירה יחידה/.test(t3) && /מעל 3 שנים/.test(t3) && /20 שנים/.test(t3), 'מזרחי-טפחות (WISE): דירה יחידה, ותק "מעל 3 שנים", "20 שנים"')
  assert(await page.locator('[data-subl$="|pama"]').count() === 1 && await page.locator('[data-subl$="|mimun"]').count() === 1, 'גם פמה ומימון ישיר ברשימה')
  await shot(page, 'submit-mizrahi')

  step('נייד 390px')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => render()); await page.waitForTimeout(500); await page.evaluate(() => document.getElementById('subcard').scrollIntoView()); await shot(page, 'submit-390')
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(ovf <= 1, 'בלי גלילה לרוחב ב-390px (' + ovf + ')')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהגשה לגוף — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 } finally {
  await page.evaluate(async (id) => { await write('clients/' + id, { deletedAt: stamp() }, 'update'); if (S.intakes.has(id)) await write('intakes/' + id, { deletedAt: stamp() }, 'update') }, CID).catch(() => {})
  await b.close()
}
