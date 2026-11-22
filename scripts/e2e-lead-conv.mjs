/**
 * לידים (דן 22/11): סנכרון לפי פלטפורמה ("⚠ לבדוק" כשפלטפורמה נעצרה) + המרה קפדנית לכל קמפיין בכל פלטפורמה.
 * 30 לידים סינתטיים בפלטפורמה שנעצרה לפני 4 ימים + ליד שחתם (נפתח לקוח עם תקבול) → שיווק ← "המרה, סנכרון ו-ROI". נמחק בסוף. CHROMIUM=<נתיב>
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
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const ids = Array.from({ length: 30 }, (_, i) => 'e2econv-' + i)
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.evaluate(async (ids) => {
    for (const [i, id] of ids.entries()) { const at = new Date(Date.now() - (96 + i * 12) * 36e5).toISOString()
      await write('leads/' + id, { id, name: 'ליד המרה ' + i, phone: '05400' + String(10000 + i), division: 'finance', platform: 'E2E-פלטפורמה', campaign: i % 2 ? 'E2E-רכב' : 'E2E-נכסים', stage: i === 0 ? 'invalid' : i < 10 ? 'contacted' : 'new', createdAt: at, updatedAt: stamp(), ...(i === 3 ? { clientId: 'e2econv-client' } : {}) }) }
    await write('clients/e2econv-client', { id: 'e2econv-client', name: 'לקוח המרה', division: 'finance', status: 'open', stage: 'signed_collecting_docs', fee: 6000, createdAt: stamp(), updatedAt: stamp(), tags: [], log: [], checklist: [] })
    await write('transactions/e2econv-tx', { id: 'e2econv-tx', division: 'finance', nature: 'income', clientId: 'e2econv-client', date: today(), net: 3000, gross: 3540, deductible: true, review: 'ok', source: 'e2e', counterparty: 'לקוח המרה', createdAt: stamp(), updatedAt: stamp() })
    await write('campaigns/e2econv-camp', { id: 'e2econv-camp', name: 'E2E-רכב', platform: 'E2E-פלטפורמה', spend: 1500, division: 'finance', startDate: addDays(today(), -60), createdAt: stamp(), updatedAt: stamp() })
  }, ids)
  await page.waitForFunction(() => S.leads.has('e2econv-29') && S.campaigns.has('e2econv-camp') && S.transactions.has('e2econv-tx'))
  await page.evaluate(() => { S.f.mktDiv = 'finance'; S.f.mkt = 'roi'; go('marketing') }); await page.waitForSelector('#syncCard')

  step('סנכרון לפי פלטפורמה')
  const row = page.locator('#syncCard tr', { hasText: 'E2E-פלטפורמה' })
  assert(/⚠ 96 שעות בלי ליד — לבדוק/.test(await row.textContent()), 'הפלטפורמה שנעצרה לפני 4 ימים — "⚠ לבדוק"')

  step('המרה קפדנית לפי קמפיין')
  const car = await page.locator('#convCard tr', { hasText: 'E2E-רכב' }).first().textContent()
  assert(/E2E-רכב\s*15\s*0\s*15/.test(car), 'רכב: 15 לידים, 0 זיכוי, 15 תקינים')
  assert(/1\s*6\.7%/.test(car), 'חתם 1 (נפתח לקוח) = 6.7%')
  assert(/1,500/.test(car) && /100/.test(car), 'עלות 1,500 · 100 לליד תקין')
  const prop = await page.locator('#convCard tr', { hasText: 'E2E-נכסים' }).first().textContent()
  assert(/E2E-נכסים\s*15\s*1\s*14/.test(prop), 'נכסים: 15 לידים, 1 לא תקין, 14 תקינים')
  assert(!errs.length, 'אין שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהכל עבר ✓')
} finally {
  await page.evaluate(async (ids) => { for (const p of [...ids.map((i) => 'leads/' + i), 'clients/e2econv-client', 'transactions/e2econv-tx', 'campaigns/e2econv-camp']) await write(p, { deletedAt: stamp() }, 'update').catch(() => {}) }, ids).catch(() => {})
  await b.close()
}
