/**
 * בדיקת קצה-לקצה — עורך ה-PDF (דן 31/10: "כמו pdfFiller"):
 *   טופס בעברית ואנגלית → טפסים ← ✏️ עורך PDF (מהמחשב) → לחיצה על שם קיים = עריכה במקום → תיבת טקסט חדשה →
 *   ✨ שדות ריקים → לחיצה על ריבוע הסימון = ✓ → מחיקת אזור → שמירה כקובץ חדש →
 *   בקובץ שנשמר: השם החדש, בלי הישן (נמחק מהקובץ, לא רק כוסה), הטקסט שנוסף, והטקסט באזור שנמחק — לא קיים.
 *   צילומים ב-390 / 768 / 1280 (הנחיה 24). נתונים סינתטיים בלבד.
 *
 *   BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-pdfedit.mjs
 *   PDFJS_DIR=<תיקייה עם pdf.min.js ו-pdf.worker.min.js 3.11.174> — כשאין גישה ל-cdnjs · E2E_OUT=<תיקייה לצילומים>
 */
import { chromium } from 'playwright'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const OUT = process.env.E2E_OUT ?? null
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }

// pdf-lib (fontkit) הופך בעצמו מחרוזת עברית — כותבים את הטקסט הלוגי (בלי ספרות בתוך עברית), והוא יוצא בסדר הנכון
async function form() {
  const d = await PDFDocument.create(); d.registerFontkit(fontkit)
  const he = await d.embedFont(readFileSync(path.join('assets', 'fonts', 'liberation', 'LiberationSans-Regular.ttf')), { subset: true })
  const hv = await d.embedFont(StandardFonts.Helvetica)
  const p = d.addPage([595.28, 841.89])
  const right = (t, x, y, size = 12) => p.drawText(t, { x: x - he.widthOfTextAtSize(t, size), y, size, font: he })
  right('בקשה לבדיקת זכאות', 545, 790, 16)
  right('שם הלווה: ישראל ישראלי', 545, 740)
  p.drawText('Account No. 12345 — Bank Hapoalim', { x: 50, y: 700, size: 11, font: hv, color: rgb(0.1, 0.2, 0.6) })
  right('תאריך:', 545, 660, 11); p.drawLine({ start: { x: 360, y: 658 }, end: { x: 500, y: 658 }, thickness: 0.7 })
  p.drawRectangle({ x: 535, y: 620, width: 10, height: 10, borderWidth: 0.8, borderColor: rgb(0, 0, 0) }); right('אני מאשר את התנאים', 528, 621, 11)
  right('הערה פנימית שצריך למחוק', 545, 560, 11)
  return Buffer.from(await d.save())
}
const textOf = (bytes) => { const doc = mupdf.Document.openDocument(bytes, 'application/pdf'); try { return doc.loadPage(0).toStructuredText('').asText() } finally { doc.destroy() } }
// mupdf מחזיר שורת עברית בסדר לוגי או חזותי לפי הקובץ — בודקים את שתיהן
const has = (t, s) => t.replace(/\s+/g, ' ').includes(s) || t.replace(/\s+/g, ' ').includes([...s].reverse().join(''))

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
if (process.env.PDFJS_DIR) await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', (r) => r.fulfill({ body: readFileSync(path.join(process.env.PDFJS_DIR, r.request().url().includes('worker') ? 'pdf.worker.min.js' : 'pdf.min.js'), 'utf8'), contentType: 'text/javascript' }))
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const errs = []; page.on('pageerror', (e) => errs.push(e.message))
const shot = async (name) => { if (!OUT) return; mkdirSync(OUT, { recursive: true }); for (const w of [390, 768, 1280]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(OUT, `pdfedit-${name}-${w}.png`) }) } await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(250) }
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })

  step('טפסים ← ✏️ עורך PDF: קובץ מהמחשב')
  await page.evaluate(() => go('forms')); await page.waitForSelector('input[data-pxup]', { state: 'attached' })
  await page.setInputFiles('input[data-pxup]', { name: 'בקשה לבדיקת זכאות.pdf', mimeType: 'application/pdf', buffer: await form() })
  await page.waitForFunction(() => S.px && S.px.A && document.querySelectorAll('#pxEd .pxs').length > 3, null, { timeout: 30000 })
  await page.waitForTimeout(800)
  const spans = await page.evaluate(() => S.px.A.pages[0].spans.map((s) => s.text))
  assert(spans.includes('שם הלווה: ישראל ישראלי') && spans.some((s) => s.startsWith('Account No. 12345')), 'הטקסט הקיים זוהה (עברית בסדר לוגי, אנגלית): ' + spans.length + ' קטעים')
  await shot('open')

  step('עריכת טקסט קיים: לחיצה על השם → כותבים → Enter')
  const nameSel = await page.evaluate(() => { const s = S.px.A.pages[0].spans.find((x) => x.text.includes('ישראלי')); return '.pxs[data-ps="0:' + s.id + '"]' })
  await page.click('#pxEd ' + nameSel)
  await page.fill('#pxEd .pxin', 'שם הלווה: Dana כהן-לוי')
  await page.keyboard.press('Enter')
  const acc = await page.evaluate(() => { const s = S.px.A.pages[0].spans.find((x) => x.text.startsWith('Account')); return '.pxs[data-ps="0:' + s.id + '"]' })
  await page.click('#pxEd ' + acc); await page.fill('#pxEd .pxin', 'Account No. 54321 — Bank Hapoalim'); await page.keyboard.press('Enter')
  assert(await page.evaluate(() => Object.keys(S.px.edits).length === 2), 'שתי עריכות נרשמו')

  step('תיבת טקסט חדשה + ✓ בשדה ריק שזוהה + מחיקת אזור')
  await page.click('#pxEd [data-pxt="text"]')
  const box = await page.locator('#pxEd .pg').first().boundingBox()
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.45)
  await page.keyboard.type('נבדק ע"י דן 31/10')
  await page.click('#pxEd [data-px="blanks"]')
  const blanks = await page.evaluate(() => S.px.A.pages[0].blanks.map((x) => x.kind + ':' + x.label))
  assert(blanks.some((x) => x.startsWith('date:תאריך')) && blanks.some((x) => x.startsWith('checkbox:')), 'שדות ריקים זוהו: ' + blanks.join(', '))
  await page.click('#pxEd .pxb[data-pb="0:' + (await page.evaluate(() => S.px.A.pages[0].blanks.findIndex((x) => x.kind === 'checkbox'))) + '"]')
  const del = await page.evaluate(() => S.px.A.pages[0].spans.find((x) => x.text.includes('שצריך למחוק')).rect)
  await page.click('#pxEd [data-pxt="erase"]')
  const P = await page.evaluate(() => S.px.A.pages[0])
  const at = (x, y) => [box.x + x / P.w * box.width, box.y + y / P.h * box.height]
  await page.mouse.move(...at(del[0] - 3, del[1] - 3)); await page.mouse.down(); await page.mouse.move(...at(del[2] + 3, del[3] + 3), { steps: 6 }); await page.mouse.up()
  const n = await page.evaluate(() => ({ adds: S.px.adds.map((a) => a.kind), erase: S.px.erase.length }))
  assert(n.adds.includes('text') && n.adds.includes('check') && n.erase === 1, 'נוספו: ' + n.adds.join(', ') + ' · אזור מחיקה אחד')
  await shot('edited')

  step('שמירה כקובץ חדש')
  await page.click('#pxEd [data-px="save"]')
  await page.waitForFunction(() => /נשמר ✓/.test(document.querySelector('#pxSel')?.textContent || ''), null, { timeout: 60000 })
  const href = await page.getAttribute('#pxSel a.btn', 'href')
  const sel = await page.textContent('#pxSel')
  assert(/2 מתוך 2 עריכות נבדקו/.test(sel), 'השרת בדק: ' + sel.replace(/\s+/g, ' ').slice(0, 120))
  const res = await page.request.get(BASE + href); assert(res.ok(), 'הקובץ החדש נפתח: ' + href)
  const t = textOf(await res.body())
  const fileId = href.split('/').pop()
  const A = await (await page.request.post(BASE + '/api/crm/pdf/analyze', { data: { src: { file: fileId } } })).json()
  const lines = A.pages[0].spans.map((x) => x.text)
  assert(lines.includes('שם הלווה: Dana כהן-לוי'), 'השם החדש בקובץ — עברית ואנגלית באותה שורה, בסדר הנכון')
  if (process.env.E2E_DEBUG) console.log(JSON.stringify(lines))
  assert(lines.includes('נבדק ע"י דן 31/10'), 'תיבת הטקסט שנוספה — בסדר הנכון')
  assert(!has(t, 'ישראלי'), 'השם הישן נמחק מהקובץ (לא רק כוסה)')
  assert(t.includes('54321') && !t.includes('12345'), 'מספר החשבון הוחלף')
  assert(has(t, 'נבדק') && t.includes('31/10'), 'הטקסט שנוסף בקובץ')
  assert(!has(t, 'שצריך למחוק') && has(t, 'בקשה לבדיקת זכאות'), 'האזור שנמחק — לא בקובץ; השאר נשאר')
  assert(await page.evaluate(() => S.px && S.px.A && Object.keys(S.px.edits).length === 0 && /\(ערוך\)/.test(S.px.name)), 'העורך ממשיך על הקובץ החדש: ' + await page.evaluate(() => S.px.name))
  await shot('saved')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nעורך PDF — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 }
finally { await b.close() }
