/**
 * בדיקת קצה-לקצה — טבלה בדף עו״ש בעורך ה-PDF (דן 1/11: "לא מזהה את הכל — אני צריך לבחור איפה להזין"):
 *   טבלה עם קווים ותאים ריקים → ✨ שדות ריקים: אין "שורות שלמות", יש תאים ריקים עם שם העמודה → לחיצה על תא ריק →
 *   כותבים סכום → בקובץ: על קו הבסיס של השורה, מיושר כמו שאר העמודה, באותו גופן וגודל · לחיצה על טקסט קיים = עריכה (לא שדה חדש).
 *   נתונים סינתטיים בלבד.  BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium [PDFJS_DIR=…] [E2E_OUT=…] node scripts/e2e-pdf-table.mjs
 */
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000', OUT = process.env.E2E_OUT ?? null
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }

async function statement() {
  const d = await PDFDocument.create(); d.registerFontkit(fontkit)
  const f = await d.embedFont(readFileSync(path.join('assets', 'fonts', 'liberation', 'LiberationSans-Regular.ttf')), { subset: true }), p = d.addPage([595.28, 841.89])
  const cols = [60, 160, 240, 320, 520], top = 700, rh = 20
  const rows = [['יתרה', 'חובה', 'זכות', 'תיאור'], ['5431.09', '28.80', '', 'עמלת פעולה'], ['7155.00', '', '13524', 'זיכוי מיידי'], ['606.69', '', '240', 'זיכוי מבנק']]
  for (let i = 0; i <= rows.length; i++) p.drawLine({ start: { x: cols[0], y: top - i * rh }, end: { x: cols[4], y: top - i * rh }, thickness: 0.6 })
  for (const x of cols) p.drawLine({ start: { x, y: top }, end: { x, y: top - rows.length * rh }, thickness: 0.6 })
  rows.forEach((r, i) => r.forEach((t, j) => { if (t) p.drawText(t, { x: cols[j + 1] - 4 - f.widthOfTextAtSize(t, 10), y: top - i * rh - 14, size: 10, font: f }) }))
  return Buffer.from(await d.save())
}

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
if (process.env.PDFJS_DIR) await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', (r) => r.fulfill({ body: readFileSync(path.join(process.env.PDFJS_DIR, r.request().url().includes('worker') ? 'pdf.worker.min.js' : 'pdf.min.js'), 'utf8'), contentType: 'text/javascript' }))
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.evaluate(() => go('pdfedit')); await page.waitForSelector('input[data-pxup]', { state: 'attached' })
  await page.setInputFiles('input[data-pxup]', { name: 'דף חשבון.pdf', mimeType: 'application/pdf', buffer: await statement() })
  await page.waitForFunction(() => S.px && S.px.A && S.px.doc && document.querySelectorAll('#pxEd .pxs').length > 8, null, { timeout: 30000 }); await page.waitForTimeout(600)

  step('✨ שדות ריקים בטבלה')
  await page.click('#pxEd [data-px="blanks"]')
  const B = await page.evaluate(() => S.px.A.pages[0].blanks.map((x) => x.from + ':' + x.label))
  assert(!B.some((x) => x.startsWith('line:')) && B.filter((x) => x.startsWith('cell:')).length === 3, 'תאים ריקים בלבד, בלי "שורות שלמות": ' + B.join(', '))
  if (OUT) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, 'table-blanks.png') }) }

  step('לחיצה על טקסט קיים = עריכה, לא שדה חדש')
  const sp = await page.evaluate(() => { const s = S.px.A.pages[0].spans.find((x) => x.text === '28.80'); return '.pxs[data-ps="0:' + s.id + '"]' })
  await page.click('#pxEd ' + sp); assert(await page.isVisible('#pxEd .pxin'), 'נפתח לעריכה'); await page.keyboard.press('Escape')

  step('לחיצה על תא ריק בעמודת "זכות" → כותבים סכום')
  const ci = await page.evaluate(() => S.px.A.pages[0].blanks.findIndex((x) => x.from === 'cell' && x.label === 'זכות'))
  await page.click('#pxEd .pxb[data-pb="0:' + ci + '"]'); await page.keyboard.type('1000.00')
  const a = await page.evaluate(() => { const a = S.px.adds[S.px.adds.length - 1]; return { align: a.align, size: a.size, base: a.baseline, match: a.match } })
  const ref = await page.evaluate(() => { const S0 = S.px.A.pages[0].spans; return { row: S0.find((x) => x.text === '28.80'), col: S0.find((x) => x.text === '13524') } })
  assert(a.align === 'right' && a.size === ref.col.size && Math.abs(a.base - ref.row.baseline) < 0.01, `התיבה: מיושרת ${a.align}, ${a.size}pt, על קו הבסיס של השורה`)

  step('שמירה ובדיקה בקובץ')
  await page.click('#pxEd [data-px="save"]')
  await page.waitForFunction(() => S.px.saved && !S.px.busy && document.querySelector('#pxSel a.btn'), null, { timeout: 60000 })
  const fileId = (await page.getAttribute('#pxSel a.btn', 'href')).split('/').pop()
  const A = await (await page.request.post(BASE + '/api/crm/pdf/analyze', { data: { src: { file: fileId } } })).json()
  const n = A.pages[0].spans.find((x) => x.text === '1000.00')
  assert(n && Math.abs(n.baseline - ref.row.baseline) < 0.3 && Math.abs(n.rect[2] - ref.col.rect[2]) < 0.8 && Math.abs(n.size - ref.col.size) < 0.1 && n.font.replace(/-\d+$/, '') === ref.col.font.replace(/-\d+$/, ''),
    `בקובץ: "1000.00" בשורה הנכונה, מיושר לקצה העמודה (${n && n.rect[2]} מול ${ref.col.rect[2]}), ${n && n.size}pt, ${n && n.font}`)
  if (OUT) await page.screenshot({ path: path.join(OUT, 'table-saved.png') })
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nטבלה בעורך — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 } finally { await b.close() }
