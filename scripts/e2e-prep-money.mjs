/**
 * דן 22/11 (חלק 3): שמאים לפי קרן בהכנה להגשה · צפי סגירה אחרי התוכנית (שאילתה → תשובה סביר/בטוח → מפת החודש)
 * · ימי תשלום (קבועה באשראי → 15, מצב אשראי מחליף, ספק ב-10) · ציר הגשות (מדדים, גרפים, פירוט) · מוכנות להגשה · "ההגשות שלי לבנקים".
 * נתונים סינתטיים, נמחקים בסוף; ההגדרות חוזרות למה שהיו. CHROMIUM=<נתיב> · JSPDF / H2C=<נתיבים> כשאין cdnjs
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
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept())
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const C1 = 'e2epm-prep', C2 = 'e2epm-eta', EX = 'e2epm-exp'
let saved = null
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  saved = await page.evaluate(() => JSON.parse(JSON.stringify({ appraisers: S.settings.appraisers ?? null, suppliers: S.settings.suppliers ?? null, cardBalance: S.settings.cardBalance ?? null, cardDay: S.settings.cardDay ?? null, accruals: S.settings.accruals ?? null })))
  const t0 = await page.evaluate(() => today())
  await page.evaluate(async ([C1, C2, EX]) => {
    await write('settings/main', { appraisers: [...(S.settings.appraisers || []), { id: 'e2eap1', name: 'שמאי א Test', area: 'פתח תקווה', funds: { 'פריסבי': 'yes' }, price: 2000 }, { id: 'e2eap2', name: 'שמאי ב Test', area: 'פתח תקווה', funds: { 'פריסבי': 'no' } }, { id: 'e2eap3', name: 'שמאי ג Test', area: 'חיפה', funds: { 'פריסבי': 'yes' }, pref: ['פריסבי'] }] }, 'update')
    const base = { division: 'finance', createdAt: stamp(), updatedAt: stamp(), createdBy: S.me.id, tags: [], log: [], checklist: [{ label: 'ת״ז + ספח', status: 'done' }, { label: 'תלושים', status: 'pending' }] }
    await write('clients/' + C1, { id: C1, name: 'לקוח הכנה Test', status: 'open', stage: 'signed_collecting_docs', product: 'refinance', fee: 9000, proc: { type: 'mortgage', step: 'prep', plan: { fund: 'פריסבי' }, appr: { target: 1500000 } }, submissions: [{ bank: 'פמה', status: 'submitted', submittedAt: addDays(today(), -3) }, { bank: 'פריסבי', status: 'approved', submittedAt: addDays(today(), -40) }, { bank: 'מימון ישיר', status: 'declined', submittedAt: addDays(today(), -35) }], ...base })
    await write('intakes/' + C1, { id: C1, clientId: C1, borrowers: [{ name: 'לקוח הכנה', idNumber: '000000018', income: 20000, emp: 'salaried' }, {}], request: { amount: 600000, years: 20, purpose: 'refinance' }, property: { value: 1500000, city: 'פתח תקווה' }, credit: {}, createdAt: stamp() })
    await write('clients/' + C2, { id: C2, name: 'לקוח צפי Test', status: 'open', stage: 'signed_collecting_docs', product: 'refinance', fee: 10000, proc: { type: 'mortgage', step: 'analysis' }, ...base })
    await write('expenses/' + EX, { id: EX, name: 'תוכנה Test', amount: 500, frequency: 'monthly', day: 3, payBy: 'card', division: 'finance', active: true, createdAt: stamp() })
  }, [C1, C2, EX])
  await page.waitForFunction(([a, b, x]) => S.clients.has(a) && S.clients.has(b) && S.expenses.has(x) && appraisers().some((p) => p.id === 'e2eap3'), [C1, C2, EX])

  step('שמאים לפי הקרן בהכנה להגשה')
  await page.evaluate((id) => go('client', id), C1); await page.waitForSelector('#apprPick')
  const names = await page.locator('#apprPick tbody tr td.wide').allTextContents()
  assert(/^⭐ שמאי ג Test/.test(names[0]) && /שמאי א Test/.test(names[1]), 'מועדף ראשון, אחריו מאושר באזור: ' + names.slice(0, 2).join(' · '))
  assert(/לא מאושרים בפריסבי \(1\)/.test(await page.locator('#apprPick').textContent()), 'הלא מאושר — מקופל בסוף')
  await page.locator('[data-apfund="e2eap1|פריסבי|pref"]').first().click(); await page.waitForFunction(() => (appraisers().find((a) => a.id === 'e2eap1').pref || []).includes('פריסבי'))
  assert(true, '⭐ נשמר לשמאי לקרן הזו')
  await page.locator('#apprPick [data-apchoose="e2eap1"]').first().click(); await page.waitForFunction((id) => (S.clients.get(id).proc.appr || {}).appraiser === 'שמאי א Test', C1)
  const ap = await page.evaluate((id) => S.clients.get(id).proc.appr, C1)
  assert(ap.fund === 'פריסבי' && ap.price === 2000, 'נבחר — עם הקרן והמחיר הרגיל')

  step('מוכנות להגשה + ההגשות שלי לבנקים')
  const R = await page.evaluate((id) => readyCalc(readyInput(S.clients.get(id))), C1)
  assert(R.digital.cats.find((c) => c.key === 'data').done === 6 && R.digital.cats.find((c) => c.key === 'ltv').done === 1 && R.digital.cats.find((c) => c.key === 'poa').done === 0, 'נתונים מלאים, אחוז מימון 40% תקין, אין כתבי הסמכה')
  await page.evaluate((id) => { S.f.ctool = { ...(S.f.ctool || {}), [id]: 'ready' }; render() }, C1); await page.waitForSelector('#readyCard')
  const p1 = R.digital.pct
  await page.locator('#readyCard details.rcat').first().evaluate((d) => { d.open = true })
  await page.locator('[data-readypoa="' + C1 + '|לאומי"]').check(); await page.waitForFunction((id) => !!(S.clients.get(id).poa || {})['לאומי'], C1)
  const p2 = await page.evaluate((id) => readyCalc(readyInput(S.clients.get(id))).digital.pct, C1)
  assert(p2 > p1, 'סימון כתב הסמכה ללאומי — המוכנות עלתה ' + p1 + '% → ' + p2 + '%')
  const html = await page.evaluate((id) => mySubsHtml(S.clients.get(id)), C1)
  assert(/3<\/div><div[^>]*>הגשות/.test(html) && /50%<\/div><div[^>]*>שיעור אישור/.test(html) && /ממתינים לתשובה \(1\)/.test(html), 'ההגשות שלי: 3 הגשות, 50% אישור, 1 ממתין')
  if (process.env.JSPDF && process.env.H2C) { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate((id) => mySubsPdf(S.clients.get(id)), C1)]); assert(readFileSync(await dl.path()).subarray(0, 5).toString() === '%PDF-', 'הדפסת דוח — PDF') }

  step('צפי סגירה: אחרי התוכנית — שאילתה לדן; עד שעונה — לא נספר')
  const inF = () => page.evaluate((id) => forecastItems(120).items.some((i) => i.cid === id), C2)
  assert(!(await inF()), 'לפני התשובה — התיק לא בצפי')
  await page.evaluate((id) => procAdvance(S.clients.get(id)), C2)
  await page.waitForFunction((id) => live(S.tasks).some((t) => t.etaAsk && t.clientId === id && t.status !== 'done'), C2)
  assert(true, 'נפתחה משימה לדן: "צפי סגירה: מתי תיסגר העסקה?"')
  await page.evaluate(() => { S.f.money = 'month'; S.f.mapMonth = null; go('money') }); await page.waitForSelector('#etaCard')
  assert(/מחכים לתשובה שלך/.test(await page.locator('#etaCard').textContent()), 'במפת החודש: "מחכים לתשובה שלך"')
  await page.locator('#etaCard [data-etaask="' + C2 + '"]').click(); await page.waitForSelector('.drawer')
  const eta = await page.evaluate(() => addDays(today(), 5)); await page.fill('#d_date', eta); await page.selectOption('#d_conf', 'sure'); await page.click('#dsave')
  await page.waitForFunction((id) => !!S.clients.get(id).closeEta, C2)
  const it = await page.evaluate((id) => forecastItems(120).items.find((i) => i.cid === id), C2)
  assert(it && it.date === eta && it.sure === true && Math.round(it.amount) === 11800, 'בצפי: ' + it.date + ' · בטוח · 11,800 (שכ״ט + מע״מ)')
  assert(await page.waitForFunction((id) => !live(S.tasks).some((t) => t.etaAsk && t.clientId === id && t.status !== 'done'), C2, { timeout: 8000 }).then(() => true).catch(() => false), 'המשימה נסגרה')

  step('ימי תשלום: קבועה באשראי ב-15 · מצב אשראי מחליף · ספק ב-10')
  const card = await page.evaluate(() => forecastItems(70).items.filter((i) => /תוכנה Test/.test(i.label)).map((i) => i.date))
  assert(card.length && card.every((d) => d.slice(8) === '15'), 'הקבועה באשראי (ב-3 לחודש) יורדת ב-15: ' + card.join(', '))
  await page.evaluate(() => write('settings/main', { cardBalance: { amount: 7300, date: today() } }, 'update')); await page.waitForFunction(() => S.settings.cardBalance && S.settings.cardBalance.amount === 7300)
  const cb = await page.evaluate(() => { const F = forecastItems(70).items, nd = nextCardDay(today(), cardDayOf()); return { bal: F.filter((i) => i.card && i.date === nd).map((i) => -i.amount), sw: F.filter((i) => /תוכנה Test/.test(i.label) && i.date === nd).length } })
  assert(cb.bal[0] === 7300 && cb.sw === 0, 'החיוב הבא = מצב האשראי (7,300), והקבועה לא נספרת פעמיים')
  await page.evaluate(async () => { await write('settings/main', { suppliers: [...(S.settings.suppliers || []), { id: 'e2esup', name: 'ספק Test', day: 10, by: 'bank' }], accruals: { ...(S.settings.accruals || { items: [], recur: [] }), items: [...((S.settings.accruals || {}).items || []), { id: 'e2eacc', label: 'ספק Test — חשבון', month: today().slice(0, 7), amount: 1000, vatIncl: true, kind: 'marketing' }] } }, 'update') })
  await page.waitForFunction(() => supplierList().some((x) => x.id === 'e2esup'))
  const sp = await page.evaluate(() => forecastItems(70).items.find((i) => i.supplier === 'e2esup'))
  assert(sp && sp.date.slice(8) === '10' && sp.date > t0 && sp.amount === -1000, 'ספק ב-10: ' + sp.date + ' · 1,000')

  step('ציר הגשות')
  await page.evaluate(() => { S.f.lendView = 'dash'; S.f.lendDiv = 'finance'; go('lenders') }); await page.waitForSelector('[data-subdashp]')
  const k = await page.evaluate(() => { const Rg = subDashRange('year', today()); return subDashStats(subDashRows(), Rg.from, Rg.to, Rg.prevFrom) })
  assert(k.n >= 3 && k.approved >= 1 && k.declined >= 1, 'מדדים: ' + k.n + ' הגשות · ' + k.approved + ' אושרו · ' + k.declined + ' נדחו')
  await page.locator('rect[data-subdash$="|g|submitted"]').last().click(); await page.waitForSelector('#subDashDrill')
  assert(/לקוח הכנה Test/.test(await page.locator('#subDashDrill').textContent()), 'לחיצה על עמודה — פירוט ההגשות')
  assert(!errs.length, 'אין שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהכל עבר ✓')
} finally {
  await page.evaluate(async ([C1, C2, EX, saved]) => {
    for (const p of ['clients/' + C1, 'clients/' + C2, 'intakes/' + C1, 'expenses/' + EX]) await write(p, { deletedAt: stamp() }, 'update').catch(() => {})
    for (const t of live(S.tasks).filter((t) => [C1, C2].includes(t.clientId))) await write('tasks/' + t.id, { deletedAt: stamp() }, 'update').catch(() => {})
    if (saved) await write('settings/main', saved, 'update')
  }, [C1, C2, EX, saved]).catch((e) => console.error('ניקוי:', e.message))
  await b.close()
}
