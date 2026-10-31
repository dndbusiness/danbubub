/**
 * בדיקת קצה-לקצה — OCR לסרוקים (דן 31/10: "תבנה OCR לסורקים"):
 *   טופס בעברית → "סריקה" (תמונה בלבד, 200dpi) → טפסים ← ✏️ עורך PDF → "המסמך סרוק" → 🔎 OCR (Tesseract בדפדפן, heb+eng) →
 *   השורות זוהו (עברית בסדר הנכון) · שדות ריקים מהתמונה עם התוויות שנקראו → לחיצה על השם הסרוק = עריכה →
 *   שמירה: הפיקסלים של השם הישן נמחקו, השם החדש כתוב, והטקסט שזוהה נשמר כשכבה בר-חיפוש →
 *   הקובץ החדש נפתח בלי צורך ב-OCR נוסף. צילומים ב-390 / 768 / 1280. נתונים סינתטיים בלבד.
 *
 *   BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-pdf-ocr.mjs
 *   PDFJS_DIR=<pdf.min.js + pdf.worker.min.js 3.11.174> · TESS_DIR=<node_modules עם tesseract.js@6.0.1, tesseract.js-core,
 *   @tesseract.js-data/heb, @tesseract.js-data/eng> — כשאין גישה ל-cdnjs / jsdelivr · E2E_OUT=<תיקייה לצילומים>
 */
import { chromium } from 'playwright'
import { PDFDocument, rgb } from 'pdf-lib'
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

async function scanned() {
  const d = await PDFDocument.create(); d.registerFontkit(fontkit)
  const he = await d.embedFont(readFileSync(path.join('assets', 'fonts', 'liberation', 'LiberationSans-Regular.ttf')), { subset: true })
  const p = d.addPage([595.28, 841.89]), ink = rgb(0.08, 0.1, 0.3)
  const right = (t, x, y, size = 12) => p.drawText(t, { x: x - he.widthOfTextAtSize(t, size), y, size, font: he, color: ink })
  right('בקשה לבדיקת זכאות', 545, 790, 16)
  right('שם הלווה: ישראל ישראלי', 545, 740)
  right('תאריך:', 545, 690, 12); p.drawLine({ start: { x: 340, y: 688 }, end: { x: 495, y: 688 }, thickness: 1 })
  p.drawRectangle({ x: 533, y: 640, width: 12, height: 12, borderWidth: 1.2, borderColor: rgb(0, 0, 0) }); right('אני מאשר את התנאים', 525, 642, 12)
  const md = mupdf.Document.openDocument(await d.save(), 'application/pdf')
  const png = md.loadPage(0).toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceRGB, false).asPNG()
  const s = await PDFDocument.create(), im = await s.embedPng(png); s.addPage([595.28, 841.89]).drawImage(im, { x: 0, y: 0, width: 595.28, height: 841.89 })
  return Buffer.from(await s.save())
}

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
if (process.env.PDFJS_DIR) await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', (r) => r.fulfill({ body: readFileSync(path.join(process.env.PDFJS_DIR, r.request().url().includes('worker') ? 'pdf.worker.min.js' : 'pdf.min.js'), 'utf8'), contentType: 'text/javascript' }))
if (process.env.TESS_DIR) await ctx.route('https://cdn.jsdelivr.net/npm/**', (r) => {
  const u = new URL(r.request().url()).pathname.replace(/^\/npm\//, '')
  const rel = u.replace(/^tesseract\.js@[^/]+\//, 'tesseract.js/').replace(/^tesseract\.js-core@[^/]+\//, 'tesseract.js-core/').replace(/^@tesseract\.js-data\/([^/@]+)(@[^/]+)?\//, '@tesseract.js-data/$1/')
  const f = path.join(process.env.TESS_DIR, rel)
  if (!existsSync(f)) return r.fulfill({ status: 404, body: 'not found: ' + rel })
  return r.fulfill({ body: readFileSync(f), contentType: f.endsWith('.wasm') ? 'application/wasm' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' })
})
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const errs = []; page.on('pageerror', (e) => errs.push(e.message))
const shot = async (name) => { if (!OUT) return; mkdirSync(OUT, { recursive: true }); for (const w of [390, 768, 1280]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(OUT, `pdfocr-${name}-${w}.png`) }) } await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(250) }
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })

  step('סרוק → עורך PDF: "המסמך סרוק" + כפתור OCR; שדות ריקים כבר מהתמונה')
  await page.evaluate(() => go('forms')); await page.waitForSelector('input[data-pxup]', { state: 'attached' })
  await page.setInputFiles('input[data-pxup]', { name: 'סריקה מהבנק.pdf', mimeType: 'application/pdf', buffer: await scanned() })
  await page.waitForFunction(() => S.px && S.px.A && S.px.doc, null, { timeout: 30000 })
  const pre = await page.evaluate(() => ({ scanned: S.px.A.pages[0].scanned, spans: S.px.A.pages[0].spans.length, blanks: S.px.A.pages[0].blanks.map((x) => x.kind), notice: !!document.querySelector('.pxscan [data-px="ocr"]') }))
  assert(pre.scanned && pre.spans === 0 && pre.notice, 'זוהה כסרוק, בלי טקסט, עם הצעה ל-OCR')
  assert(pre.blanks.includes('checkbox') && pre.blanks.includes('text'), 'שדות ריקים מהתמונה עוד לפני OCR: ' + pre.blanks.join(', '))
  await shot('scanned')

  step('🔎 OCR — Tesseract בדפדפן')
  const t0 = Date.now()
  await page.click('.pxscan [data-px="ocr"]')
  await page.waitForFunction(() => S.px.ocr[0] && S.px.ocr[0].length > 2 && !S.px.ocrBusy, null, { timeout: 180000 })
  const lines = await page.evaluate(() => S.px.ocr[0].map((s) => s.text))
  assert(lines.includes('שם הלווה: ישראל ישראלי') && lines.includes('בקשה לבדיקת זכאות'), `זוהה בעברית בסדר הנכון (${Math.round((Date.now() - t0) / 1000)} שניות): ${lines.join(' | ')}`)
  const blanks = await page.evaluate(() => S.px.A.pages[0].blanks.map((x) => x.kind + ':' + x.label))
  assert(blanks.some((x) => x.startsWith('date:תאריך')) && blanks.some((x) => x.startsWith('checkbox:אני מאשר')), 'שדות ריקים עם התוויות שנקראו: ' + blanks.join(', '))
  const col = await page.evaluate(() => S.px.ocr[0].find((s) => s.text.includes('ישראלי')).color)
  assert(/^#[0-4][0-9a-f][0-4][0-9a-f][2-7][0-9a-f]$/.test(col), 'צבע הדיו נלקח מהסריקה: ' + col)

  step('עריכת השם הסרוק + ✓ בריבוע שזוהה')
  const sel = await page.evaluate(() => { const s = S.px.ocr[0].find((x) => x.text.includes('ישראלי')); return '.pxs[data-ps="0:' + s.id + '"]' })
  const oldRect = await page.evaluate(() => S.px.ocr[0].find((x) => x.text.includes('ישראלי')).rect)
  await page.click('#pxEd ' + sel); await page.fill('#pxEd .pxin', 'שם הלווה: משה כהן'); await page.keyboard.press('Enter')
  await page.click('#pxEd [data-px="blanks"]')
  await page.click('#pxEd .pxb[data-pb="0:' + (await page.evaluate(() => S.px.A.pages[0].blanks.findIndex((x) => x.kind === 'checkbox'))) + '"]')
  await shot('ocr-edited')

  step('שמירה: פיקסלים נמחקים, טקסט חדש, שכבה בר-חיפוש')
  await page.click('#pxEd [data-px="save"]')
  await page.waitForFunction(() => S.px.saved && S.px.A && !S.px.busy && document.querySelector('#pxSel a.btn'), null, { timeout: 60000 })
  const href = await page.getAttribute('#pxSel a.btn', 'href'), fileId = href.split('/').pop()
  const A = await (await page.request.post(BASE + '/api/crm/pdf/analyze', { data: { src: { file: fileId } } })).json()
  const sp = A.pages[0].spans
  assert(sp.some((s) => s.text === 'שם הלווה: משה כהן' && !s.hidden), 'השם החדש כתוב בקובץ')
  assert(sp.some((s) => s.hidden && s.text === 'בקשה לבדיקת זכאות') && sp.some((s) => s.hidden && s.text === 'אני מאשר את התנאים'), 'הטקסט שזוהה נשמר כשכבה נסתרת (בר-חיפוש)')
  assert(!sp.some((s) => s.text.includes('ישראלי')), 'השם הישן לא בשכבה')
  const bytes = await (await page.request.get(BASE + href)).body()
  const md = mupdf.Document.openDocument(bytes, 'application/pdf'), pix = md.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceGray, false), px = pix.getPixels(), W = pix.getWidth()
  // "ישראלי" — המילה השמאלית בשורה הסרוקה; השורה החדשה קצרה יותר ומיושרת לימין, כך ש-20pt השמאליים של השורה הישנה ריקים
  let dark = 0, total = 0
  for (let y = Math.ceil(oldRect[1] * 2) + 1; y < Math.floor(oldRect[3] * 2) - 1; y++) for (let x = Math.ceil(oldRect[0] * 2); x < Math.floor((oldRect[0] + 20) * 2); x++) { total++; if (px[y * W + x] < 128) dark++ }
  assert(total > 100 && dark === 0, 'הפיקסלים של המילה הישנה נמחקו מהתמונה עצמה')
  assert(A.pages[0].scanned && A.pages[0].spans.some((s) => s.hidden), 'הקובץ החדש: סרוק עם טקסט מזוהה — לא צריך OCR שוב')
  await page.waitForFunction(() => S.px.A && S.px.A.pages[0].spans.length > 2, null, { timeout: 30000 })
  assert(await page.evaluate(() => !document.querySelector('.pxscan')), 'בעורך: אין הצעה ל-OCR נוסף, הטקסט ניתן לעריכה')
  await shot('saved')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nOCR לסרוקים — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 }
finally { await b.close() }
