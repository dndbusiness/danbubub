/**
 * בדיקת קצה-לקצה — ייבוא ספריית הטפסים מתיקייה בדרייב (דן, 18/10: "כל המסמכי בנקים"):
 *   תיקייה (דרייב מדומה) עם תת-תיקיות לפי גוף → "📥 ייבוא מדרייב" → קישור → סריקה (תיקיות + מספר טפסים) → ייבוא →
 *   כל PDF = טופס בתיקייה בשם תת-התיקייה ("LOANWISE - לואן ווייז" → "loanwise - לואן ווייז" שכבר ברשימה), קבצים בשורש — "כללי",
 *   השדות הוצבו לבד, וכל טופס "לבדיקה" · "לווה 2" שהוא אותו קובץ כמו "לווה 1" — מקבל את אותם שדות ·
 *   ריצה שנייה = 0 טפסים חדשים (§11.9) · "שדות" ← שמור = יוצא מ"לבדיקה" ·
 *   טופס "לווה 2" (חותם אחד) בכרטיס לקוח — נשלח לבן הזוג, עם הת"ז שלו מהכרטיס.
 * נתונים סינתטיים בלבד; הדרייב מדומה (שום קריאה לגוגל). מנקה אחריו.
 *
 *   BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-sign-drive.mjs
 *   PDFJS_DIR=<תיקייה עם pdf.min.js ו-pdf.worker.min.js 3.11.174> — כשאין גישה ל-cdnjs (סביבת בדיקה סגורה)
 */
import { chromium } from 'playwright'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const url = process.env.DATABASE_URL || env.DATABASE_URL
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const CLIENT = 'e2e-drive-client'

const vis = (s) => [...s].reverse().join('')
async function hebForm(title, two) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(path.join('assets', 'fonts', 'DejaVuSans.ttf')), { subset: true })
  const p = doc.addPage([595.28, 841.89])
  const label = (t, x, y) => { const s = vis(t); p.drawText(s, { x: x - font.widthOfTextAtSize(s, 11), y, size: 11, font }) }
  const line = (x1, x2, y) => p.drawLine({ start: { x: x1, y: y - 2 }, end: { x: x2, y: y - 2 }, thickness: 0.6, color: rgb(0.5, 0.5, 0.5) })
  p.drawText(title, { x: 50, y: 800, size: 14, font })
  label('שם מלא:', 540, 700); line(300, 470, 700)
  label('ת.ז:', 540, 670); line(380, 500, 670)
  label('תאריך:', 540, 300); line(400, 495, 300)
  label('חתימה:', 540, 250); line(330, 495, 250)
  if (two) { label('חתימה:', 280, 250); line(60, 235, 250) }
  return Buffer.from(await doc.save())
}

// הדרייב המדומה: שורש → 2 תת-תיקיות + קובץ בשורש. "לווה 1" ו"לווה 2" — אותו קובץ בדיוק (כמו בתיקייה של דן)
const waiver = await hebForm('Waiver'), app2 = await hebForm('Application', true), gen = await hebForm('General')
const DRIVE = {
  ROOT_E2E_0123456789: [
    { id: 'F_LW', title: 'LOANWISE - לואן ווייז', mimeType: 'application/vnd.google-apps.folder' },
    { id: 'F_T', title: 'בדיקת E2E דרייב', mimeType: 'application/vnd.google-apps.folder' },
    { id: 'P_GEN', title: 'טופס כללי E2E.pdf', mimeType: 'application/pdf' },
  ],
  F_LW: [{ id: 'P_W1', title: 'ויתור סודיות לווה 1 E2E.pdf', mimeType: 'application/pdf' }, { id: 'P_W2', title: 'ויתור סודיות לווה 2 E2E.pdf', mimeType: 'application/pdf' }],
  F_T: [{ id: 'P_APP', title: 'בקשה להלוואה E2E.pdf', mimeType: 'application/pdf' }, { id: 'X_TXT', title: 'הערות.txt', mimeType: 'text/plain' }],
}
const BYTES = { P_W1: waiver, P_W2: waiver, P_APP: app2, P_GEN: gen }
const NAMES = ['ויתור סודיות לווה 1 E2E', 'ויתור סודיות לווה 2 E2E', 'בקשה להלוואה E2E', 'טופס כללי E2E']

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const staff = await b.newContext({ viewport: { width: 1280, height: 900 } })
if (process.env.PDFJS_DIR) await staff.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', (r) => r.fulfill({ body: readFileSync(path.join(process.env.PDFJS_DIR, r.request().url().includes('worker') ? 'pdf.worker.min.js' : 'pdf.min.js'), 'utf8'), contentType: 'text/javascript' }))
let driveCalls = 0
await staff.route('**/api/crm/mcp', async (r) => {
  const { server, tool, input } = JSON.parse(r.request().postData() || '{}')
  if (server !== 'Google Drive') return r.continue()
  driveCalls++
  if (tool === 'search_files') { const m = String(input.query || '').match(/parentId = '([^']+)'/); return r.fulfill({ json: { payload: { files: m ? DRIVE[m[1]] || [] : [] } } }) }
  if (tool === 'download_file_content') { const buf = BYTES[input.fileId]; return buf ? r.fulfill({ json: { payload: { id: input.fileId, mimeType: 'application/pdf', content: buf.toString('base64') } } }) : r.fulfill({ status: 404, json: { message: 'not found' } }) }
  return r.fulfill({ status: 400, json: { message: 'unexpected tool ' + tool } })
})
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await staff.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await staff.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const pageErrs = []; page.on('pageerror', (e) => pageErrs.push(e.message))
let envIds = [], reviewBefore = null
const ours = () => sql`select id, name, folder, category, scope, fields from sign_templates where name in ${sql(NAMES)} and deleted_at is null order by name`
try {
  await sql`update sign_templates set deleted_at = now() where name in ${sql(NAMES)} and deleted_at is null`
  await sql`insert into crm_docs (coll, doc_id, data) values ('clients', ${CLIENT}, ${sql.json({ id: CLIENT, name: 'דנה כהן', idNumber: '000000018', email: 'dana@example.com', phone: '0521234567',
    spouseName: 'Avi Levi', spouseId: '000000026', spouseEmail: 'avi@example.com', spousePhone: '0527654321', division: 'finance', status: 'active', product: 'mortgage', log: [] })})
    on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  reviewBefore = await page.evaluate(() => S.settings.signTplReview || null)

  step('ספריית טפסים → "📥 ייבוא מדרייב" → קישור → סריקה')
  await page.evaluate(() => { S.f.formsView = 'lib'; go('forms') }); await page.waitForTimeout(600)
  await page.click('[data-act="pdfDriveImport"]')
  await page.fill('#pdImpUrl', 'https://drive.google.com/drive/folders/ROOT_E2E_0123456789?usp=sharing')
  await page.click('#pdImpGo')
  await page.waitForSelector('[data-pdimpf]', { timeout: 15000 })
  const scan = await page.locator('#pdImpBody').innerText()
  const folders = await page.$$eval('[data-pdimpf]', (xs) => xs.map((x) => x.dataset.pdimpf))
  assert(folders.length === 3 && folders.includes('loanwise - לואן ווייז') && folders.includes('בדיקת E2E דרייב') && folders.includes('כללי'), '3 תיקיות: הגוף הקיים בספרייה (בלי הבדל אותיות), תיקייה חדשה, ו"כללי" לקבצים בשורש (' + folders.join(' | ') + ')')
  assert(/נמצאו 4 טפסי PDF/.test(scan) && /1 קבצים שאינם PDF/.test(scan), '4 טפסים; הקובץ שאינו PDF לא ייובא')
  if (process.env.E2E_OUT) await page.screenshot({ path: path.join(process.env.E2E_OUT, 'drive-import-scan@1280.png') })
  assert(/ייבא 4 טפסים/.test(await page.locator('#pdImpGo').innerText()), 'הכפתור: "ייבא 4 טפסים"')

  step('ייבוא: הורדה → העלאה → זיהוי שדות → תבנית, מסומנת "לבדיקה"')
  await page.click('#pdImpGo')
  await page.waitForFunction(() => /הספרייה עודכנה/.test(($('pdImpBody') || {}).innerText || ''), null, { timeout: 90000 })
  const done = await page.locator('#pdImpBody').innerText()
  if (process.env.E2E_OUT) await page.screenshot({ path: path.join(process.env.E2E_OUT, 'drive-import-done@1280.png') })
  assert(/4 טפסים נוצרו \(1 מהם קיבלו את השדות של טופס זהה/.test(done), 'נוצרו 4; "לווה 2" קיבל את השדות של "לווה 1" (אותו קובץ)')
  const T = await ours()
  assert(T.length === 4, '4 תבניות בספרייה')
  const by = Object.fromEntries(T.map((t) => [t.name, t]))
  assert(by['ויתור סודיות לווה 1 E2E'].folder === 'loanwise - לואן ווייז' && by['טופס כללי E2E'].folder === 'כללי' && by['בקשה להלוואה E2E'].folder === 'בדיקת E2E דרייב', 'כל טופס בתיקייה של הגוף שלו')
  assert(by['ויתור סודיות לווה 1 E2E'].category === 'poa' && by['בקשה להלוואה E2E'].category === 'bank' && T.every((t) => t.scope === 'system'), 'סוג לפי השם (ויתור סודיות = ייפוי כוח), מסמכי מערכת')
  const sig = (t, s) => t.fields.filter((f) => f.kind === 'signature' && f.signer === s).length
  assert(sig(by['בקשה להלוואה E2E'], 1) === 1 && sig(by['בקשה להלוואה E2E'], 2) === 1, 'בקשה: שתי חתימות = שני לווים')
  assert(by['ויתור סודיות לווה 1 E2E'].fields.some((f) => f.kind === 'name') && by['ויתור סודיות לווה 1 E2E'].fields.some((f) => f.kind === 'id_number'), 'ויתור: שם ות"ז זוהו')
  assert(JSON.stringify(by['ויתור סודיות לווה 2 E2E'].fields) === JSON.stringify(by['ויתור סודיות לווה 1 E2E'].fields), '"לווה 2" = אותם שדות כמו "לווה 1"')
  await page.waitForFunction((n) => (S.settings.signTplReview || []).length >= n, (reviewBefore || []).length + 4, { timeout: 10000 })
  const rv = await page.evaluate((ids) => ids.filter((id) => (S.settings.signTplReview || []).includes(id)).length, T.map((t) => t.id))
  assert(rv === 4, 'כל 4 מסומנים "לבדיקה"')

  step('ספרייה: "לבדיקה" — סינון, ו"שדות" ← שמור מוציא מהרשימה')
  await page.click('#pdImpGo'); await page.waitForTimeout(800)
  const chipTxt = await page.locator('[data-plreview]').first().innerText()
  assert(/לבדיקה/.test(chipTxt) && (await page.locator('#plLib .tplrow').count()) >= 4, 'אחרי הייבוא: הספרייה מסוננת ל"לבדיקה" (' + chipTxt.replace(/\s+/g, ' ') + ')')
  if (process.env.E2E_OUT) await page.screenshot({ path: path.join(process.env.E2E_OUT, 'drive-import-review@1280.png') })
  await page.click(`[data-pdftplfields="${by['טופס כללי E2E'].id}"]`)
  await page.waitForSelector('#pdfEd', { timeout: 20000 }); await page.waitForTimeout(800)
  await page.click('#pdfEd [data-pe="save"]')
  await page.waitForFunction((id) => !(S.settings.signTplReview || []).includes(id), by['טופס כללי E2E'].id, { timeout: 10000 })
  assert(true, '"שדות" ← שמור: הטופס כבר לא "לבדיקה"')

  step('ריצה שנייה על אותה תיקייה = 0 טפסים חדשים (§11.9)')
  await page.click('[data-act="pdfDriveImport"]')
  await page.fill('#pdImpUrl', 'ROOT_E2E_0123456789'); await page.click('#pdImpGo')
  await page.waitForSelector('[data-pdimpf]', { timeout: 15000 })
  const again = await page.locator('#pdImpBody').innerText()
  assert(/2 כבר בספרייה/.test(again) && await page.locator('#pdImpGo').isDisabled() && /אין מה לייבא/.test(await page.locator('#pdImpGo').innerText()), 'הסריקה מראה שהכל כבר בספרייה; "אין מה לייבא"')
  await page.click('#scrim [data-close]'); await page.waitForTimeout(200)
  assert((await ours()).length === 4, 'עדיין 4 תבניות')

  step('טופס "לווה 2" בכרטיס לקוח → נשלח לבן הזוג, עם הת"ז שלו')
  const w2 = by['ויתור סודיות לווה 2 E2E'].id
  await page.evaluate(({ c, id }) => { S.signForm = S.signForm || {}; S.signForm[c] = { open: true, tpl: 'pdf:' + id }; S.f.formsView = 'send'; go('forms', c) }, { c: CLIENT, id: w2 }); await page.waitForTimeout(1200)
  const lab = await page.locator('#signcard [data-signs$=":label"]').first().inputValue(), nm = await page.locator('#signcard [data-signs$=":name"]').first().inputValue()
  assert((await page.locator('#signcard [data-signs$=":name"]').count()) === 1 && lab === 'לווה 2' && nm === 'Avi Levi', 'חותם אחד: "לווה 2" — Avi Levi (בן הזוג), לא הלקוחה')
  await page.click('#signcard [data-act="signSend"]'); await page.waitForTimeout(2500)
  const [e1] = await sql`select id from sign_envelopes where client_doc = ${CLIENT} and deleted_at is null order by created_at desc limit 1`; envIds.push(e1.id)
  const [r1] = await sql`select signer_label, send_email, fields->'@prefill' pre from sign_requests where envelope_id = ${e1.id}`
  assert(r1.signer_label === 'לווה 2' && r1.send_email === 'avi@example.com' && r1.pre.idNumber === '000000026' && r1.pre.name === 'Avi Levi', 'נשלח לבן הזוג: מייל, שם ות"ז שלו ממולאים מראש')

  step('390px: חלון הייבוא בלי גלילה לרוחב')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { $('layer').innerHTML = ''; S.f.formsView = 'lib'; go('forms') }); await page.waitForTimeout(400)
  await page.click('[data-act="pdfDriveImport"]'); await page.fill('#pdImpUrl', 'ROOT_E2E_0123456789'); await page.click('#pdImpGo'); await page.waitForSelector('[data-pdimpf]', { timeout: 15000 })
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (process.env.E2E_OUT) await page.screenshot({ path: path.join(process.env.E2E_OUT, 'drive-import@390.png') })
  assert(ov <= 0, 'אין גלילה לרוחב ב-390 (' + ov + ')')
  assert(driveCalls > 0, 'כל הקריאות לדרייב עברו דרך /api/crm/mcp (' + driveCalls + ')')
  assert(!pageErrs.length, 'אין שגיאות בדף' + (pageErrs.length ? ': ' + pageErrs.join(' | ') : ''))
  console.log('\nייבוא מדרייב — עבר.')
} finally {
  for (const id of envIds) { await sql`update sign_envelopes set deleted_at = coalesce(deleted_at, now()) where id = ${id}`.catch(() => {}); await sql`update sign_requests set deleted_at = coalesce(deleted_at, now()) where envelope_id = ${id}`.catch(() => {}) }
  await sql`update sign_templates set deleted_at = now() where name in ${sql(NAMES)} and deleted_at is null`.catch(() => {})
  await sql`update crm_docs set deleted_at = now() where coll = 'clients' and doc_id = ${CLIENT}`.catch(() => {})
  await page.evaluate((v) => write('settings/main', { signTplReview: v || [] }, 'update'), reviewBefore).catch(() => {})
  await b.close(); await sql.end()
}
