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

  step('✎ הזנה ועריכה — נשמר פעם אחת ומשמש את כל הגופים')
  await page.click('[data-subl$="|frisbee"]'); await page.waitForSelector('[data-subed="bx.gender#0"]')
  await page.click('[data-subed="bx.gender#0"]'); await page.fill('#dform input[name="v0"]', 'נקבה'); await page.click('#dsave')
  await page.waitForFunction(() => /✎ הוזן/.test(document.getElementById('subcard').textContent))
  await page.click('[data-subl$="|mimun"]'); await page.waitForFunction(() => /סוג הקשר בעסקה/.test(document.getElementById('subcard').textContent))
  assert(await page.evaluate(() => [...document.querySelectorAll('#subcard tr')].some((tr) => /^\s*\d+\s*מין/.test(tr.textContent) && /נקבה/.test(tr.textContent))), 'מגדר שהוזן בפריסבי מופיע ב"מין" של מימון ישיר')
  await page.click('[data-subed="b.income#0"]'); await page.fill('#dform input[name="v0"]', '15200'); await page.click('#dsave')
  await page.waitForFunction(() => [...document.querySelectorAll('#subcard tr')].some((tr) => /משכורת חודשית נטו/.test(tr.textContent) && /15200/.test(tr.textContent) && /✎ הוזן/.test(tr.textContent)))
  assert(true, 'עריכת שדה שבא מהתיק (נטו 14,000 → 15,200) — מסומן "✎ הוזן"')
  await page.click('[data-act="subEditAll"]'); const nAll = await page.locator('#dform input[name^="v"]').count()
  await page.fill('#dform input[name="v0"]', ''); await page.click('#layer [data-close]')
  assert(nAll >= 10, '"✎ הזן את החסרים" — כל השדות שחסרים בגוף בטופס אחד (' + nAll + ')')

  step('✨ מילוי מהמסמכים (Claude מדומה) → הצעה → מאשרים חלק → נשמר')
  await page.evaluate((id) => {
    S.docRes = { ...(S.docRes || {}), [id]: { files: [{ id: 'f1', title: 'ת״ז Avi.pdf', mimeType: 'application/pdf', cat: 'private' }, { id: 'f2', title: 'תלוש שכר 10-2026.pdf', mimeType: 'application/pdf', cat: 'income' }, { id: 'f3', title: 'הסכם שכירות.pdf', mimeType: 'application/pdf' }] } }
    window.docBlob = async () => new Blob(['x'], { type: 'application/pdf' })
    window.askDoc = async (b, prompt, st, label) => /ת״ז/.test(label) ? { person: { name: 'Avi Levi', id: '000000026' }, gender: 'זכר', idIssue: '05/05/2015', birth: '' }
      : { person: { name: 'דנה כהן-לוי', id: '000000018' }, employer: 'Acme בע״מ', role: 'מנהלת חשבונות', workStart: '01/06/2019', netIncome: '15200' }
    render()
  }, CID)
  await page.click('[data-act="subScan"]'); await page.waitForSelector('#subscan')
  await page.evaluate(() => document.getElementById('subscan').scrollIntoView()); await shot(page, 'submit-scan')
  const sc = await page.textContent('#subscan')
  assert(/זכר/.test(sc) && /05\/05\/2015/.test(sc) && /Acme/.test(sc) && /נקראו 2 מסמכים/.test(sc), 'נקראו רק ת״ז ותלוש (לא ההסכם); הוצעו מגדר + הנפקה ללווה 2, מעסיק לדנה')
  assert(!/15200|15,200/.test(sc), 'נטו שכבר שווה לתיק — לא מוצע שוב')
  await page.locator('#subscan [data-subsug]').nth(3).uncheck(); await page.click('[data-act="subScanOk"]'); await page.waitForFunction(() => !document.getElementById('subscan'))
  const sv = await page.evaluate((id) => S.intakes.get(id).subVals, CID)
  assert(sv['bx.gender#1'] === 'זכר' && sv['bx.employer#0'] === 'Acme בע״מ' && sv['bx.gender#0'] === 'נקבה' && !sv['bx.role#0'] && Object.keys(sv).length === 6, 'אושרו 4 מתוך 5 (התפקיד לא סומן — לא נשמר) → נשמרו, עם מה שהוזן קודם')

  step('📎 המסמכים של הגוף מול התיק · ✍️ הטפסים של הגוף לחתימה')
  await page.click('[data-subl$="|pama"]'); await page.waitForFunction(() => /מסמכים לפמה/.test(document.getElementById('subcard').textContent))
  assert(/✓ בתיק:\s*ת״ז Avi\.pdf/.test(await page.textContent('#subcard')), 'פמה: "ת״ז + ספח" → ✓ בתיק')
  await page.click('[data-act="subDocsSel"]'); assert(await page.evaluate(() => S.docSel.size === 1 && S.docSel.has('f1')), 'סמן לשליחה → הקובץ מסומן במסמכי הלקוח')
  await page.evaluate(() => { S.pdfTpls = { templates: [{ id: 'tA', name: 'כתב הסמכה — פריסבי', folder: 'פריסבי מימון', signers: 2, fields: [], pages: 1, page_sizes: [[595, 842]] }, { id: 'tB', name: 'ויתור סודיות — פריסבי', folder: 'פריסבי מימון', signers: 2, fields: [], pages: 1, page_sizes: [[595, 842]] }, { id: 'tC', name: 'טופס של בנק אחר', folder: 'בנק לאומי', signers: 1, fields: [], pages: 1, page_sizes: [[595, 842]] }], top: [] }; render() })
  await page.click('[data-subl$="|frisbee"]'); await page.waitForSelector('#subsign')
  await page.evaluate(() => document.getElementById('subsign').scrollIntoView({ block: 'center' })); await shot(page, 'submit-sign')
  const sg = await page.textContent('#subsign')
  assert(/כתב הסמכה — פריסבי/.test(sg) && /ויתור סודיות — פריסבי/.test(sg) && !/בנק אחר/.test(sg), 'פריסבי: רק הטפסים מתיקיית פריסבי בספרייה')
  await page.click('#subsign [data-subsign^="pdfs:"]'); assert(await page.evaluate((id) => S.signForm[id].tpl === 'pdfs:tA,tB', CID), '"שלח את כל הטפסים בקישור אחד" → נפתח בשליחה לחתימה עם שני הטפסים')

  step('נייד 390px')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => render()); await page.waitForTimeout(500); await page.evaluate(() => document.getElementById('subcard').scrollIntoView()); await shot(page, 'submit-390')
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(ovf <= 1, 'בלי גלילה לרוחב ב-390px (' + ovf + ')')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהגשה לגוף — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 } finally {
  await page.evaluate(async (id) => { await write('clients/' + id, { deletedAt: stamp() }, 'update'); if (S.intakes.has(id)) await write('intakes/' + id, { deletedAt: stamp() }, 'update') }, CID).catch(() => {})
  await b.close()
}
