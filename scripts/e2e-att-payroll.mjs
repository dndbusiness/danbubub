/**
 * נוכחות → שכר (דן 22/11): "שעון נוכחות במשמרת עד סוף היום · כרטיס העובד מתעדכן מהשעון · דוח שעות להורדה בכל זמן · בונוסים".
 * עובד סינתטי עם תעריף שעתי + שני ימי משמרת → השעות בכרטיס השכר מהשעון → הקלדה ידנית גוברת → "↺ מהשעון" → בונוס → דוח שעות CSV ו-PDF
 * → שעון רץ למעלה בזמן משמרת. הכל נמחק בסוף. CHROMIUM=<נתיב> · JSPDF / H2C=<נתיבים> כשאין cdnjs
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
if (process.env.JSPDF) await ctx.route('**/jspdf/2.5.1/jspdf.umd.min.js', (r) => r.fulfill({ path: process.env.JSPDF, contentType: 'application/javascript' }))
if (process.env.H2C) await ctx.route('**/html2canvas/1.4.1/html2canvas.min.js', (r) => r.fulfill({ path: process.env.H2C, contentType: 'application/javascript' }))
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message))
const answers = ['יעד סגירות', '300']; page.on('dialog', (d) => d.accept(answers.shift() ?? ''))
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const K = 'e2eatt'
let before = null, M = null
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  before = await page.evaluate(() => JSON.parse(JSON.stringify((S.settings.payroll || {}).employees || [])))
  M = await page.evaluate(() => today().slice(0, 7))
  await page.evaluate(async ([K, M]) => {
    const emps = [...((S.settings.payroll || {}).employees || []), { key: K, attKey: K, name: 'עובד שעון Test', division: 'finance', components: [{ id: 'h', type: 'rate', label: 'שעות', unit: 'hours', rate: 50 }] }]
    await write('settings/main', { payroll: { ...(S.settings.payroll || {}), employees: emps } }, 'update')
    const day = (d, i, o) => write('attendance/' + K + '_' + d, { id: K + '_' + d, key: K, label: 'עובד שעון Test', date: d, div: 'finance', in: { at: d + 'T' + i + ':00.000Z', place: 'office' }, out: { at: d + 'T' + o + ':00.000Z', place: 'office' }, lastActive: d + 'T' + o + ':00.000Z' })
    await day(M + '-02', '07:00', '15:30'); await day(M + '-03', '06:30', '15:00')
  }, [K, M])
  await page.waitForFunction((K) => payEmployees().some((e) => e.key === K) && live(S.attendance).filter((a) => a.key === K).length === 2, K)

  step('כרטיס השכר: השעות מהשעון')
  await page.evaluate((M) => { S.f.payMonth = M; S.f.books = 'payroll'; go('books') }, M); await page.waitForSelector('.grid3'); await page.waitForTimeout(300)
  const tot = () => page.evaluate(([K, M]) => { const e = payEmployees().find((x) => x.key === K); return payCalc(e, payDocEff(M, e)).total }, [K, M])
  assert((await tot()) === 850, 'שכר = 17 שעות מהשעון × 50 = 850')
  assert(await page.locator('.pill', { hasText: '17 מהשעון' }).count() === 1, 'בכרטיס: "⏱ 17 מהשעון"')
  const inp = page.locator('[data-pay="' + K + '"][data-pq="hours"]')
  await inp.fill('10'); await inp.dispatchEvent('change'); await page.waitForFunction(([K, M]) => (payDoc(M, K).q || {}).hours === 10, [K, M])
  assert((await tot()) === 500, 'הקלדה ידנית (10 שעות) גוברת — 500')
  await page.locator('[data-payclock="' + K + '|hours"]').click(); await page.waitForFunction(([K, M]) => (payDoc(M, K).q || {}).hours == null, [K, M])
  assert((await tot()) === 850, '"↺ מהשעון" — חוזר ל-17 שעות')

  step('בונוס מעבר לשכר')
  await page.locator('[data-paybonus="' + K + '"]').click(); await page.waitForFunction(([K, M]) => (payDoc(M, K).bonuses || []).length === 1, [K, M])
  assert((await tot()) === 1150, 'בונוס "יעד סגירות" 300 → 1,150')
  await page.waitForSelector('.chip:has-text("יעד סגירות")', { timeout: 4000 }).catch(() => {})
  assert(await page.locator('.chip', { hasText: 'יעד סגירות' }).count() === 1, 'הבונוס מוצג בכרטיס')
  step('אישור מקפיא את השעות')
  await page.locator('[data-payok="' + K + '"]').click(); await page.waitForFunction(([K, M]) => payDoc(M, K).approved, [K, M])
  assert((await page.evaluate(([K, M]) => payDoc(M, K).q.hours, [K, M])) === 17, 'באישור נשמרו 17 השעות בחודש')

  step('דוח שעות להורדה')
  const R = await page.evaluate(([K, M]) => attReport(M + '-01', M + '-28', K), [K, M])
  assert(R.rows.length === 2 && R.sum[0].h === 17 && R.sum[0].days === 2, 'בדוח: 2 ימים, 17 שעות')
  await page.evaluate((M) => { S.f.attDay = M + '-05'; S.f.attRepWho = 'e2eatt'; go('reports') }, M)
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.evaluate(() => attReportDl('csv'))])
  const csv = readFileSync(await dl.path(), 'utf8')
  assert(/עובד שעון Test,\d{4}-\d\d-02,\d\d:\d\d,\d\d:\d\d,8\.50/.test(csv) && /סה״כ עובד שעון Test,2 ימים,,,17\.00/.test(csv), 'CSV: שורה לכל יום + סה״כ')
  if (process.env.JSPDF && process.env.H2C || !process.env.NO_CDN) {
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => attReportDl('pdf'))])
    assert(readFileSync(await dl2.path()).subarray(0, 5).toString() === '%PDF-', 'PDF: ' + dl2.suggestedFilename())
  }

  step('שעון המשמרת למעלה')
  await page.evaluate(() => { S.myKey = S.myKey || 'dan' })
  const myKey = await page.evaluate(() => S.myKey)
  const had = await page.evaluate(() => !!attDoc())
  if (!had) {
    await page.evaluate(async () => { const id = attId(S.myKey), at = new Date(Date.now() - 95 * 60e3).toISOString(); await write('attendance/' + id, { id, key: S.myKey, label: whoAmI(), date: today(), div: 'finance', in: { at, place: 'office' }, lastActive: stamp(), e2e: true }) })
    await page.waitForFunction(() => !!attDoc()); await page.evaluate(() => render()); await page.waitForTimeout(300)
    const t = await page.locator('#shiftClock').textContent()
    assert(/⏱ 1:3[4-6]/.test(t), 'שעון רץ: ' + t + ' (' + myKey + ')')
  } else console.log('· כבר יש משמרת היום — דילוג')
  assert(!errs.length, 'אין שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהכל עבר ✓')
} finally {
  await page.evaluate(async ([K, M, before]) => {
    for (const d of ['02', '03']) await write('attendance/' + K + '_' + M + '-' + d, { deletedAt: stamp() }, 'update').catch(() => {})
    const x = payDoc(M, K); if (x.id) await write('payroll/' + x.id, { deletedAt: stamp() }, 'update').catch(() => {})
    const a = attDoc(); if (a && a.e2e) await write('attendance/' + a.id, { deletedAt: stamp() }, 'update').catch(() => {})
    if (before) await write('settings/main', { payroll: { ...(S.settings.payroll || {}), employees: before } }, 'update')
  }, [K, M, before]).catch((e) => console.error('ניקוי:', e.message))
  await b.close()
}
