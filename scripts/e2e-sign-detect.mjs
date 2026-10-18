/**
 * בדיקת קצה-לקצה — "שילמד את התבניות" ונמען ידני (דן, 18/10):
 *   שני טפסים בעברית (תוויות: שם מלא, ת.ז, חתימה ×2 בשורה, תאריך, טלפון) → העלאה מרוכזת (כל קובץ = טופס) →
 *   העורך נפתח עם השדות כבר במקום (✨ זיהוי לפי התוויות, שני לווים לפי הסדר מימין לשמאל) → שמור והמשך → דלג →
 *   בספרייה: טופס אחד, 2 חותמים, טלפון "מילוי מהתיק" · שליחה למישהו שלא במערכת (פרטים ידנית) → קישור →
 *   בדף החותם השם ות"ז ממולאים · ב"מה נשלח": "ידני" · לא נוצר לקוח או ליד.
 * נתונים סינתטיים בלבד. מנקה אחריו.
 *
 *   BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-sign-detect.mjs
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

// טופס בעברית: התווית מימין, הקו הריק משמאלה (כמו בטופסי בנק). pdf-lib לא עושה bidi — מציירים בסדר ויזואלי.
const vis = (s) => [...s].reverse().join('')
async function hebForm(title) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(path.join('assets', 'fonts', 'DejaVuSans.ttf')), { subset: true })
  const p = doc.addPage([595.28, 841.89])
  const label = (t, x, y) => { const s = vis(t); p.drawText(s, { x: x - font.widthOfTextAtSize(s, 11), y, size: 11, font }) }
  const line = (x1, x2, y) => p.drawLine({ start: { x: x1, y: y - 2 }, end: { x: x2, y: y - 2 }, thickness: 0.6, color: rgb(0.5, 0.5, 0.5) })
  p.drawText(title, { x: 50, y: 800, size: 14, font })
  label('שם מלא:', 540, 700); line(300, 470, 700)
  label('ת.ז:', 540, 670); line(380, 500, 670)
  label('טלפון:', 540, 640); line(380, 490, 640)
  label('תאריך:', 540, 300); line(400, 495, 300)
  label('חתימה:', 540, 250); line(330, 495, 250)
  label('חתימה:', 280, 250); line(60, 235, 250)
  return Buffer.from(await doc.save())
}

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const routePdfjs = async (ctx) => {
  const dir = process.env.PDFJS_DIR
  if (dir) await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', (r) => r.fulfill({ body: readFileSync(path.join(dir, r.request().url().includes('worker') ? 'pdf.worker.min.js' : 'pdf.min.js'), 'utf8'), contentType: 'text/javascript' }))
}
const staff = await b.newContext({ viewport: { width: 1280, height: 900 } }); await routePdfjs(staff)
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await staff.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await staff.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const pageErrs = []; page.on('pageerror', (e) => pageErrs.push(e.message))
let tplIds = [], envIds = []
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  // שמות בעברית — כתוכן (Playwright לא מצרף קובץ שבנתיב שלו עברית)
  const fA = { name: 'הסכמה לבדיקת אשראי.pdf', mimeType: 'application/pdf', buffer: await hebForm('Consent form A') }, fB = { name: 'טופס לדילוג.pdf', mimeType: 'application/pdf', buffer: await hebForm('Form B') }

  step('העלאה מרוכזת: שני קבצים, "כל קובץ = טופס נפרד"')
  await page.evaluate(() => go('forms')); await page.waitForTimeout(400)
  await page.evaluate(() => pdfTplForm(null)); await page.waitForTimeout(300)
  await page.selectOption('.drawer select[name="category"]', 'bank'); await page.fill('.drawer input[name="folder"]', 'בדיקה E2E')
  await page.locator('#d_pdfs').setInputFiles([fA, fB])
  await page.click('#dsave')
  await page.waitForSelector('#pdfEd', { timeout: 20000 });
  await page.waitForFunction(() => S.pe && S.pe.fields.length > 0, null, { timeout: 30000 })

  step('✨ השדות כבר במקום — לפי התוויות שעל הטופס')
  if (process.env.E2E_OUT) { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(process.env.E2E_OUT, 'pdf-detect@1280.png') }) }
  const F = await page.evaluate(() => S.pe.fields.map((f) => ({ kind: f.kind, signer: f.signer, src: f.src || null, x: f.x, y: f.y, w: f.w, h: f.h })))
  const kinds = (k, s) => F.filter((f) => f.kind === k && (s == null || f.signer === s)).length
  assert(kinds('name', 1) === 1 && kinds('id_number', 1) === 1 && kinds('date') === 1, 'שם, ת"ז ותאריך זוהו (' + F.map((f) => f.kind + f.signer).join(',') + ')')
  assert(kinds('signature', 1) === 1 && kinds('signature', 2) === 1, 'שתי חתימות באותה שורה = לווה 1 (ימין) ולווה 2 (שמאל)')
  const ph = F.find((f) => f.src === 'signer_phone'), nm = F.find((f) => f.kind === 'name')
  assert(ph && ph.kind === 'text', 'טלפון = שדה טקסט "מילוי מהתיק: טלפון החותם"')
  assert(nm.x >= 300 / 595.28 && nm.x + nm.w <= 500 / 595.28 && Math.abs(nm.y + nm.h - (1 - 700 / 841.89)) < 0.02, 'השם על הקו הריק שמשמאל לתווית, באותו גובה (x=' + nm.x.toFixed(3) + '–' + (nm.x + nm.w).toFixed(3) + ')')
  const s1 = F.find((f) => f.kind === 'signature' && f.signer === 1), s2 = F.find((f) => f.kind === 'signature' && f.signer === 2)
  assert(s1.x > s2.x && Math.abs(s1.y - s2.y) < 0.01, 'לווה 1 מימין ללווה 2, באותה שורה')
  assert(/שמור והמשך לבא/.test(await page.locator('[data-pe="save"]').innerText()) && /1 מתוך 2/.test(await page.locator('.pdfbar b').innerText()), 'בעורך: "1 מתוך 2" · "שמור והמשך לבא"')
  await page.click('[data-pe="save"]')
  await page.waitForFunction(() => S.pe && /2 מתוך 2/.test(document.querySelector('.pdfbar b')?.textContent || ''), null, { timeout: 30000 })
  page.once('dialog', (d) => d.accept()); await page.click('[data-pe="cancel"]')
  await page.waitForFunction(() => !S.pe, null, { timeout: 15000 }); await page.waitForTimeout(1500)
  const lib = await page.evaluate(() => (S.pdfTpls?.templates || []).filter((t) => t.folder === 'בדיקה E2E').map((t) => ({ id: t.id, name: t.name, signers: t.signers, n: t.fields.length, src: t.fields.map((f) => f.src).filter(Boolean) })))
  tplIds = lib.map((t) => t.id)
  assert(lib.length === 1 && lib[0].name === 'הסכמה לבדיקת אשראי' && lib[0].signers === 2, 'בספרייה: טופס אחד (השני דולג), שם = שם הקובץ, 2 חותמים')
  assert(lib[0].src.includes('signer_phone'), 'נשמר "מילוי מהתיק" לטלפון')

  step('נמען ידני — "מישהו שלא במערכת": פרטים → טופס → קישור')
  const before = await sql`select count(*)::int n from crm_docs where coll in ('clients', 'leads') and deleted_at is null`
  await page.evaluate(() => go('forms')); await page.waitForTimeout(400)
  await page.selectOption('#formsSubj', '__ext'); await page.waitForTimeout(300)
  await page.fill('.drawer input[name="name"]', 'רונית חיצונית'); await page.fill('.drawer input[name="idNumber"]', '000000059'); await page.fill('.drawer input[name="phone"]', '0541231234')
  await page.fill('.drawer input[name="name2"]', 'Yossi Out'); await page.fill('.drawer input[name="phone2"]', '0549879876')
  await page.click('#dsave'); await page.waitForTimeout(1200)
  assert(/ידני — לא נשמר במערכת/.test(await page.locator('#main').innerText()), 'במסך טפסים: "שולחים לרונית חיצונית · ידני — לא נשמר במערכת"')
  await page.selectOption('#signTpl', 'pdf:' + tplIds[0]); await page.waitForTimeout(600)
  await page.click('[data-act="signSend"]'); await page.waitForTimeout(2500)
  const links = await page.$$eval('.drawer input[readonly]', (xs) => xs.map((x) => x.value))
  assert(links.length === 2, '2 קישורים (רונית + חותם נוסף)')
  const [e] = await sql`select id, client_doc, recipient_kind, client_name from sign_envelopes where client_name = 'רונית חיצונית' and deleted_at is null order by created_at desc limit 1`
  envIds.push(e.id)
  assert(e.client_doc.startsWith('ext-') && e.recipient_kind === 'lead', 'נרשם כנמען ידני (ext-…) — בלי תיק')
  const after = await sql`select count(*)::int n from crm_docs where coll in ('clients', 'leads') and deleted_at is null`
  assert(after[0].n === before[0].n, 'לא נוצר לקוח ולא ליד')
  const sctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const sp = await sctx.newPage()
  await sp.goto(links[0]); await sp.waitForTimeout(800)
  assert(await sp.inputValue('#name') === 'רונית חיצונית' && await sp.inputValue('#idn') === '000000059', 'בדף החותם: השם ות"ז שהוקלדו — ממולאים')
  const sp2 = await sctx.newPage(); await sp2.goto(links[1]); await sp2.waitForTimeout(800)
  assert(await sp2.inputValue('#name') === 'Yossi Out', 'לחותם הנוסף — השם שלו')
  await page.click('.drawer [data-close]').catch(() => {})
  await page.evaluate(() => { S.f.formsView = 'sent'; S.signDocs = null; render() }); await page.waitForTimeout(1500)
  const sent = await page.locator('#main').innerText()
  assert(/רונית חיצונית\s*ידני/.test(sent), 'ב"מה נשלח": רונית חיצונית · ידני')
  assert(!pageErrs.length, 'בלי שגיאות JS ' + pageErrs.join(' | '))
  console.log('\n✓ זיהוי שדות, העלאה מרוכזת ונמען ידני — עובדים מקצה לקצה.')
} finally {
  for (const id of envIds) { await sql`update sign_envelopes set deleted_at = coalesce(deleted_at, now()) where id = ${id}`.catch(() => {}); await sql`update sign_requests set deleted_at = coalesce(deleted_at, now()) where envelope_id = ${id}`.catch(() => {}) }
  await sql`update sign_templates set deleted_at = now() where folder = 'בדיקה E2E' and deleted_at is null`.catch(() => {})
  await sql.end(); await b.close()
}
