/**
 * תיקוני 22/11 (דן): סגירת תיק עם פער קטן · אין "צ׳קליסט ביצוע" בכרטיס · שלב איסוף מסמכים (הרשימה מ"הכר את הלקוח",
 * בקשה במייל / וואטסאפ / העתקה, מה הועלה ומה חסר) · תמונה → PDF · תיעוד שיחות מתעניין → "הכר את הלקוח" · חתימה למתעניין
 * (סוג עם אימוג׳י, שם/טלפון/בן זוג, שכ״ט % או ₪, SMS בלי אימות ת״ז, "הכן מסמך" למעלה).
 * נתונים סינתטיים, נמחקים בסוף (soft delete). CHROMIUM=<נתיב> · JSPDF=<נתיב ל-jspdf.umd.min.js> כשאין cdnjs
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
if (process.env.JSPDF) await ctx.route('**/jspdf/2.5.1/jspdf.umd.min.js', (r) => r.fulfill({ path: process.env.JSPDF, contentType: 'application/javascript' }))
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept())
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const C1 = 'e2edc-won', C2 = 'e2edc-docs', L1 = 'e2edc-lead', TX = 'e2edc-tx'
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.evaluate(async ([C1, C2, L1, TX]) => {
    const base = { division: 'finance', createdAt: stamp(), updatedAt: stamp(), createdBy: S.me.id, tags: [], log: [] }
    await write('clients/' + C1, { id: C1, name: 'בדיקה סגירה Test', phone: '0500000001', status: 'won', stage: 'appraisal', fee: 10000, ...base, checklist: [{ label: 'פריט ישן', status: 'pending' }] })
    await write('transactions/' + TX, { id: TX, division: 'finance', nature: 'income', clientId: C1, date: '2026-11-10', net: 9800, gross: 11564, deductible: true, review: 'ok', source: 'e2e', counterparty: 'בדיקה', createdAt: stamp(), updatedAt: stamp() })
    await write('clients/' + C2, { id: C2, name: 'דני בדיקה', phone: '0500000002', email: 'e2e-docs@example.com', status: 'open', stage: 'signed_collecting_docs', product: 'refinance', proc: { step: 'docs' }, ...base, checklist: [] })
    await write('intakes/' + C2, { id: C2, clientId: C2, borrowers: [{ name: 'דני', emp: 'salaried', income: 15000 }, {}], request: { purpose: 'refinance' }, property: {}, credit: {}, createdAt: stamp(), updatedAt: stamp() })
    await write('leads/' + L1, { id: L1, name: 'מתעניין בדיקה', phone: '0500000003', stage: 'contacted', division: 'finance', source: 'manual', createdAt: stamp(), updatedAt: stamp(), log: [{ at: '2026-11-20T08:05:00.000Z', text: 'נשוי + 2, רכב 2019, צריך 60 אלף', by: S.me.id }, { at: '2026-11-20T08:00:00.000Z', text: 'סטטוס שונה', auto: true }] })
  }, [C1, C2, L1, TX])
  await page.waitForFunction(([a, b, c]) => S.clients.has(a) && S.clients.has(b) && S.leads.has(c), [C1, C2, L1])

  step('סגירת תיק עם פער של 200 ₪')
  await page.evaluate((id) => go('client', id), C1); await page.waitForTimeout(400)
  assert(!(await page.locator('h2', { hasText: 'צ׳קליסט ביצוע' }).count()), 'אין "צ׳קליסט ביצוע" בכרטיס הלקוח')
  const m0 = await page.evaluate((id) => clientMoney(S.clients.get(id)), C1)
  assert(m0.open === 200, 'פתוח לגביה 200')
  await page.locator('[data-settle="' + C1 + '"]').first().click()
  await page.waitForFunction((id) => !!S.clients.get(id).settledAt, C1)
  const m1 = await page.evaluate((id) => clientMoney(S.clients.get(id)), C1)
  assert(m1.open === 0 && m1.writeOff === 200, 'אחרי הסגירה: פתוח 0, נמחל 200')
  assert(await page.waitForSelector('text=התיק נסגר עם פער של', { timeout: 4000 }).then(() => true).catch(() => false), 'בכרטיס: "התיק נסגר עם פער של…"')
  await page.evaluate(() => { S.f.clientView = 'done'; go('clients') }); await page.waitForTimeout(300)
  const inPaid = await page.evaluate((id) => { const h = [...document.querySelectorAll('section.card')].find((s) => /הסתיימו ונגבו/.test(s.textContent)); return !!h && !!h.querySelector('[data-client="' + id + '"]') }, C1)
  assert(inPaid, 'ב"הסתיימו" — התיק ב"הסתיימו ונגבו", לא ב"עוד לא נגבה הכל"')
  await page.evaluate((id) => go('client', id), C1); await page.waitForTimeout(300)
  await page.locator('[data-unsettle="' + C1 + '"]').click(); await page.waitForFunction((id) => !S.clients.get(id).settledAt, C1)
  assert((await page.evaluate((id) => clientMoney(S.clients.get(id)).open, C1)) === 200, '"פתח מחדש" — הפער חוזר לגביה')

  step('שלב איסוף מסמכים: הרשימה מ"הכר את הלקוח", מה חסר, בקשה ללקוח')
  await page.evaluate((id) => go('client', id), C2); await page.waitForTimeout(400)
  await page.locator('[data-act="docsFromIntake"]').click()
  await page.waitForFunction((id) => (S.clients.get(id).checklist || []).length >= 5, C2)
  const ck = await page.evaluate((id) => S.clients.get(id).checklist.map((i) => i.label), C2)
  assert(ck.some((l) => /ת״ז \+ ספח/.test(l)) && ck.some((l) => /תלושי שכר/.test(l)), 'נקבעו ' + ck.length + ' מסמכים (ת״ז, תלושים…)')
  await page.waitForTimeout(500)
  const nMiss = await page.locator('.ppanel .pill.open', { hasText: 'חסר' }).count()
  assert(nMiss === ck.length, 'כל מסמך מסומן "חסר" (' + nMiss + ')')
  const txt = await page.locator('#docsAskTxt').inputValue()
  assert(/^שלום דני,/.test(txt) && /1\. /.test(txt), 'נוסח הבקשה: "שלום דני" + רשימה ממוספרת')
  assert(await page.locator('a[data-docsaskwa]').count() && await page.locator('[data-act="docsAskMail"]').count() && await page.locator('[data-act="docsAskCopy"]').count(), 'שליחה: וואטסאפ · מייל · העתקה')
  await page.locator('[data-chk="0"]').check(); await page.waitForFunction((id) => S.clients.get(id).checklist[0].status === 'done', C2)
  await page.waitForSelector('.ppanel .pill.actual:has-text("התקבל")', { timeout: 4000 }).catch(() => {})
  assert(await page.locator('.ppanel .pill.actual', { hasText: 'התקבל' }).count() === 1, 'סימון ✓ — "התקבל"')
  assert(!(await page.locator('#docsAskTxt').inputValue()).includes(ck[0]), 'המסמך שהתקבל לא בבקשה')

  step('תמונה → PDF (שתי תמונות = שני עמודים, לרוחב / לאורך)')
  const pdf = await page.evaluate(async () => { const mk = (w, h) => new Promise((ok) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#c00'; g.fillRect(0, 0, w, h); c.toBlob(ok, 'image/png') })
    const out = await imagesToPdf([await mk(1200, 1600), await mk(1600, 900)]), t = await out.text(); return { head: t.slice(0, 5), pages: (t.match(/\/Type \/Page\b/g) || []).length, type: out.type } })
  assert(pdf.head === '%PDF-' && pdf.pages === 2, 'PDF תקין עם 2 עמודים')

  step('תיעוד שיחה במתעניין → "הכר את הלקוח"')
  await page.evaluate((id) => go('intake', id), L1)
  await page.waitForFunction((id) => S.intakes.has(id) && /צריך 60 אלף/.test(S.intakes.get(id).freeText || ''), L1, { timeout: 8000 })
  const ft = await page.evaluate((id) => S.intakes.get(id).freeText, L1)
  assert(/— מהשיחות עם המתעניין —\n\[20\/11 \d\d:05\] נשוי \+ 2/.test(ft) && !/סטטוס שונה/.test(ft), 'ההערה נכנסה למלל החופשי (בלי רישומים אוטומטיים)')
  await page.evaluate((id) => go('intake', id), L1); await page.waitForTimeout(600)
  assert((await page.evaluate((id) => S.intakes.get(id).freeText.split('צריך 60 אלף').length, L1)) === 2, 'פתיחה חוזרת — לא מכפיל')

  step('חתימה למתעניין: סוג עם אימוג׳י, שם, בן/בת זוג, שכ״ט, SMS בלי ת״ז')
  await page.evaluate((id) => go('lead', id), L1); await page.waitForTimeout(500)
  if (await page.evaluate(() => !!window.__harelServer)) {
    await page.locator('[data-signprep]').click(); await page.waitForTimeout(300)
    assert(await page.evaluate(() => $('signdet') && $('signdet').open), '"✍️ הכן מסמך לחתימה" למעלה — פותח את הטופס')
    const types = await page.locator('[data-leadctype]').allTextContents()
    assert(types.join('|') === '🏠 נכסים|💼 עסקים|🚗 רכב', 'שלושה סוגים עם אימוג׳י: ' + types.join(' · '))
    await page.locator('[data-leadctype="רכב"]').click(); await page.waitForFunction((id) => S.leads.get(id).ctype === 'רכב', L1)
    await page.locator('[data-leadsign="name"]').fill('מתעניין בדיקה חדש'); await page.locator('[data-leadsign="name"]').dispatchEvent('change')
    await page.waitForFunction((id) => S.leads.get(id).name === 'מתעניין בדיקה חדש', L1)
    await page.locator('[data-leadsign="spouse"]').check(); await page.waitForFunction((id) => (S.leads.get(id).sign || {}).spouse === true, L1)
    await page.locator('[data-leadsign="spouseName"]').fill('בת זוג בדיקה'); await page.locator('[data-leadsign="spouseName"]').dispatchEvent('change')
    await page.waitForFunction((id) => (S.leads.get(id).sign || {}).spouseName === 'בת זוג בדיקה', L1); await page.waitForTimeout(300)
    const signers = await page.evaluate(() => [...document.querySelectorAll('[data-signs$=":name"]')].map((e) => e.value))
    assert(signers[0] === 'מתעניין בדיקה חדש' && signers.includes('בת זוג בדיקה'), 'החותמים: ' + signers.filter(Boolean).join(', '))
    await page.locator('[data-leadsign="amount"]').fill('60000'); await page.locator('[data-leadsign="amount"]').dispatchEvent('change'); await page.waitForTimeout(250)
    await page.locator('[data-leadsign="feePct"]').fill('8'); await page.locator('[data-leadsign="feePct"]').dispatchEvent('change')
    await page.waitForFunction((id) => (S.leads.get(id).sign || {}).feePct === 8, L1)
    assert(/8% מהסכום · הסכום המבוקש: .*60,000/.test(await page.evaluate((id) => leadFeeLine(S.leads.get(id)), L1)), 'שכ״ט 8% + הסכום המבוקש נרשמים להסכם')
    await page.locator('[data-leadfee="fixed"]').click(); await page.waitForFunction((id) => (S.leads.get(id).sign || {}).feeMode === 'fixed', L1)
    await page.locator('[data-leadsign="feeFixed"]').fill('3500'); await page.locator('[data-leadsign="feeFixed"]').dispatchEvent('change')
    await page.waitForFunction((id) => (S.leads.get(id).sign || {}).feeFixed === 3500, L1)
    assert(/סכום קבוע של .*3,500/.test(await page.evaluate((id) => leadFeeLine(S.leads.get(id)), L1)), 'או סכום קבוע ב-₪')
    assert(await page.locator('#signSmsNow').isChecked() && !(await page.locator('#signVid').isVisible()), '📱 SMS מסומן מראש — ואימות ת״ז לא מוצג')
    assert(!(await page.locator('#signTpl option', { hasText: 'טיוטה' }).count()), 'אין "טיוטה" ברשימת התבניות')
  } else console.log('· (לא בשרת — דילוג על החתימה)')
  assert(!errs.length, 'אין שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהכל עבר ✓')
} finally {
  await page.evaluate(async ([C1, C2, L1, TX]) => { for (const p of ['clients/' + C1, 'clients/' + C2, 'leads/' + L1, 'transactions/' + TX, 'intakes/' + C2, 'intakes/' + L1]) await write(p, { deletedAt: stamp() }, 'update').catch(() => {}) }, [C1, C2, L1, TX]).catch(() => {})
  await b.close()
}
