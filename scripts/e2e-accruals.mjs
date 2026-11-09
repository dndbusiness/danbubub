/**
 * התחייבויות שעוד לא שולמו (דן 09/11): כספים ← התחשבנות → "+ התחייבות" (ספק לידים לאוקטובר, שכר לנובמבר) ו"+ חוזרת כל חודש"
 * (תוכנות 1,000 כולל מע״מ) → מצב החשבון עם ניסים: שורת "פחות: התחייבויות שעוד לא שולמו" + פירוט → "שולם" רושם תנועה והרווח לא משתנה
 * (לא פעמיים) → הזנת השכר של נובמבר → התחייבות השכר יורדת לבד. נתונים סינתטיים; הכל חוזר למצב הקודם בסוף.
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
const close = (a, b) => Math.abs(a - b) < 0.02

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept())
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
let saved = null; const TX = ['e2eacc-in10', 'e2eacc-in11', 'e2eacc-ex11']
const D = () => page.evaluate(() => { const x = stmtData('all'); return x && { accNet: x.accNet, profit: x.profit, share: x.share, n: x.accItems.length, html: stmtHtml(x, false) } })
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.waitForTimeout(2000); await page.evaluate(() => { const l = document.getElementById('layer'); if (l) l.innerHTML = ''; document.getElementById('callpop')?.remove() })
  saved = await page.evaluate(() => JSON.parse(JSON.stringify({ acc: S.settings.accruals || null, pay: S.settings.payroll || null })))
  await page.evaluate(async (ids) => {
    const t = (id, x) => write('transactions/' + id, { id, division: 'finance', deductible: true, review: 'ok', source: 'e2e', createdAt: stamp(), updatedAt: stamp(), ...x })
    await t(ids[0], { nature: 'income', clientId: 'e2e-acc-client', date: '2026-10-15', net: 60000, gross: 70800, counterparty: 'לקוח בדיקה' })
    await t(ids[1], { nature: 'income', clientId: 'e2e-acc-client', date: '2026-11-03', net: 40000, gross: 47200, counterparty: 'לקוח בדיקה' })
    await t(ids[2], { nature: 'expense', date: '2026-11-04', net: -500, gross: -590, category: 'משרד', counterparty: 'ספק בדיקה' })
    await write('settings/main', { payroll: { ...(S.settings.payroll || {}), employees: [...((S.settings.payroll || {}).employees || []), { key: 'e2eh', name: 'עובדת בדיקה', division: 'finance', active: true, components: [{ id: 'c1', type: 'rate', label: 'שעות', unit: 'hours', rate: 50 }] }] } }, 'update')
  }, TX)
  await page.waitForFunction(() => S.transactions.has('e2eacc-ex11') && (S.settings.payroll?.employees || []).some((e) => e.key === 'e2eh'))
  const d0 = await D()
  await page.evaluate(() => { S.f.money = 'settle'; go('money') }); await page.waitForSelector('[data-accadd]')

  step('+ התחייבות: ספק לידים — אוקטובר 17,850 · שכר נובמבר 11,091')
  const add = async (label, month, amount, kind, emp) => { await page.click('[data-accadd]'); await page.waitForSelector('#d_label'); await page.fill('#d_label', label); await page.fill('#d_month', month); await page.fill('#d_amount', String(amount))
    await page.selectOption('#d_kind', kind); if (emp) await page.selectOption('#d_emp', emp); await page.click('#dsave'); await page.waitForFunction((l) => (S.settings.accruals?.items || []).some((x) => x.label === l), label) }
  await add('ספק לידים E2E — אוקטובר', '2026-10', 17850, 'marketing')
  await add('שכר עובדת בדיקה — נובמבר', '2026-11', 11091, 'payroll', 'e2eh')

  step('+ חוזרת כל חודש: תוכנות 1,000 כולל מע״מ מאוקטובר (קטגוריה שאין לה תנועות)')
  await page.click('[data-accrecur=""]'); await page.waitForSelector('#d_gross'); await page.fill('#d_category', 'E2E תוכנה'); await page.fill('#d_gross', '1000'); await page.fill('#d_from', '2026-10'); await page.click('#dsave')
  await page.waitForFunction(() => (S.settings.accruals?.recur || []).length > 0)
  await page.waitForTimeout(500)
  const d1 = await D(), want = 17850 + 11091 + 2 * 847.46
  assert(close(d1.accNet - d0.accNet, want), `בהתחשבנות: נוכו ${(d1.accNet - d0.accNet).toFixed(2)} (= 17,850 + 11,091 + 2×847.46)`)
  assert(close(d0.profit - d1.profit, want) && close(d0.share - d1.share, want * 0.5), 'הרווח לחלוקה ירד באותו סכום, וחלקו של ניסים בחצי ממנו')
  assert(/פחות: התחייבויות שעוד לא שולמו/.test(d1.html) && /התחייבויות שעוד לא שולמו — נוכו לפני החלוקה/.test(d1.html) && /ספק לידים E2E — אוקטובר/.test(d1.html), 'במצב החשבון (וב-PDF): שורה בסיכום + טבלת פירוט')
  await page.locator('section.card:has(h2:text("התחייבויות שעוד לא שולמו"))').scrollIntoViewIfNeeded(); await shot(page, 'acc-card')

  step('"שולם" על אוקטובר (תשלום ב-05/11) — נרשמת תנועה, הרווח לא משתנה')
  const aid = await page.evaluate(() => S.settings.accruals.items.find((x) => x.label === 'ספק לידים E2E — אוקטובר').id)
  await page.click(`[data-accpaid="${aid}"]`); await page.waitForSelector('#d_net'); await page.fill('#d_date', '2026-11-05'); await page.click('#dsave')
  await page.waitForFunction((id) => S.settings.accruals.items.find((x) => x.id === id).paidTxId && live(S.transactions).some((t) => t.accrualId === id), aid); await page.waitForTimeout(400)
  const d2 = await D(), tx = await page.evaluate((id) => { const t = live(S.transactions).find((x) => x.accrualId === id); return { net: t.net, gross: t.gross, date: t.date } }, aid)
  assert(tx.net === -17850 && tx.date === '2026-11-05', 'תנועה נרשמה: −17,850 נטו ב-05/11, מקושרת להתחייבות')
  assert(close(d2.profit, d1.profit) && close(d2.share, d1.share), `הרווח לחלוקה לא השתנה (${d2.profit.toFixed(2)}) — לא נוכה פעמיים`)

  step('הזנת שכר נובמבר (180 שעות × 50) → התחייבות השכר יורדת לבד')
  await page.evaluate(async () => { await write('payroll/2026-11__e2eh', { id: '2026-11__e2eh', month: '2026-11', emp: 'e2eh', q: { hours: 180 }, approved: false, updatedAt: stamp() }) })
  await page.waitForFunction(() => S.payroll.has('2026-11__e2eh')); await page.waitForTimeout(400)
  const d3 = await D()
  assert(close(d2.profit - d3.profit, 9000 - 11091) && !/שכר עובדת בדיקה — נובמבר/.test(d3.html.split('נוכו לפני החלוקה')[1] || ''), 'השכר בפועל (9,000) במקום ההתחייבות (11,091) — לא שניהם')

  step('נייד 390px')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => render()); await page.waitForTimeout(500)
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(ovf <= 1, 'בלי גלילה לרוחב ב-390px (' + ovf + ')')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהתחייבויות שעוד לא שולמו — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 } finally {
  if (saved) await page.evaluate(async ({ s, ids }) => {
    for (const t of live(S.transactions).filter((x) => ids.includes(x.id) || (x.accrualId && (S.settings.accruals?.items || []).some((a) => a.id === x.accrualId && /E2E/.test(a.label))))) await write('transactions/' + t.id, { deletedAt: stamp() }, 'update')
    if (S.payroll.has('2026-11__e2eh')) await write('payroll/2026-11__e2eh', { deletedAt: stamp() }, 'update')
    await write('settings/main', { accruals: s.acc || { items: [], recur: [] }, payroll: s.pay || { employees: [] } }, 'update')
  }, { s: saved, ids: TX }).catch((e) => console.error('ניקוי:', e.message))
  await b.close()
}
