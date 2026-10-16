/**
 * בדיקת קצה-לקצה — טפסים מ-PDF (מפרט "מערכת טפסים" של WISE, 019):
 *   העלאה (איחוד 2 קבצים, דחיית קובץ שאינו PDF) → תבנית בספרייה (שדות לשני לווים) →
 *   שליחה מתבנית ללקוח → לווה 1 ממלא וחותם בדף (pdf.js, מילוי חי, שדה חובה) → לווה 2 →
 *   PDF חתום = המקור + החתימות והטקסט במקומם + עמוד תיעוד → מסמך מזדמן למתעניין → מחיקה.
 * נתונים סינתטיים בלבד (לקוח/ליד "בדיקה E2E", מיילים ב-example.com). מנקה אחריו.
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=… node scripts/e2e-sign-pdf.mjs
 *   PDFJS_DIR=<תיקייה עם pdf.min.js ו-pdf.worker.min.js> — כשאין גישה ל-cdnjs (סביבת בדיקה סגורה)
 */
import { chromium } from 'playwright'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { PDFParse } from 'pdf-parse'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import { unlockGate } from './lib/gate.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const OUT = process.env.E2E_OUT ?? null
let url = process.env.DATABASE_URL
if (!url && existsSync('.env.local')) url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }

const CLIENT = 'e2e-pdf-client', LEAD = 'e2e-pdf-lead'

async function form(title, pages = 1) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595.28, 841.89])
    p.drawText(`${title} — page ${i + 1} (synthetic test form)`, { x: 50, y: 790, size: 14, font })
    for (let k = 0; k < 6; k++) p.drawLine({ start: { x: 50, y: 700 - k * 90 }, end: { x: 545, y: 700 - k * 90 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) })
  }
  return Buffer.from(await doc.save())
}

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const routePdfjs = async (ctx) => {
  const dir = process.env.PDFJS_DIR
  if (!dir) return
  await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', (r) => r.fulfill({ body: readFileSync(path.join(dir, r.request().url().includes('worker') ? 'pdf.worker.min.js' : 'pdf.min.js'), 'utf8'), contentType: 'text/javascript' }))
}
const staff = await b.newContext(); await routePdfjs(staff)
const page = await staff.newPage()
let envIds = [], tplId = null, fileIds = []
try {
  await unlockGate(page, BASE)
  await sql`insert into crm_docs (coll, doc_id, data) values ('clients', ${CLIENT}, ${sql.json({ id: CLIENT, name: 'לקוח בדיקה E2E', division: 'finance', log: [] })}),
    ('leads', ${LEAD}, ${sql.json({ id: LEAD, name: 'מתעניין בדיקה E2E', division: 'finance', log: [] })}) on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`

  step('העלאה: שני קבצים → מסמך אחד; קובץ שאינו PDF נדחה')
  const up = (files) => page.evaluate(async ({ files, base }) => {
    const fd = new FormData()
    for (const f of files) fd.append('file', new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: 'application/pdf' }))
    const r = await fetch(base + '/api/sign/files', { method: 'POST', body: fd }); return { status: r.status, body: await r.json() }
  }, { files, base: BASE })
  const bad = await up([{ name: 'לא-pdf.pdf', b64: Buffer.from('PK\u0003\u0004 not a pdf').toString('base64') }])
  assert(bad.status === 422 && /אינו PDF/.test(bad.body.message), 'קובץ שאינו PDF נדחה לפי התוכן: ' + bad.body.message)
  const merged = await up([{ name: 'עמוד1.pdf', b64: (await form('Bank form A')).toString('base64') }, { name: 'עמוד2.pdf', b64: (await form('Bank form B')).toString('base64') }])
  assert(merged.status === 200 && merged.body.pages.length === 2 && merged.body.files === 2, `איחוד: 2 קבצים → ${merged.body.pages?.length} עמודים`)
  fileIds.push(merged.body.fileId)

  step('תבנית בספרייה: "הסכמה למסירת נתוני אשראי" — בנק לאומי, שני לווים')
  const F = (o) => ({ id: Math.random().toString(36).slice(2, 9), page: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.05, kind: 'signature', signer: 1, ...o })
  const fields = [
    F({ id: 's1', kind: 'signature', signer: 1, x: 0.55, y: 0.8, w: 0.35, h: 0.07 }),
    F({ id: 'n1', kind: 'name', signer: 1, x: 0.55, y: 0.74, w: 0.35, h: 0.035 }),
    F({ id: 'i1', kind: 'id_number', signer: 1, x: 0.1, y: 0.74, w: 0.3, h: 0.035 }),
    F({ id: 'd1', kind: 'date', signer: 1, x: 0.1, y: 0.8, w: 0.2, h: 0.035 }),
    F({ id: 'acc', kind: 'text', signer: 1, page: 1, x: 0.55, y: 0.2, w: 0.35, h: 0.035, label: 'מספר חשבון', required: true }),
    F({ id: 'ok', kind: 'checkbox', signer: 1, page: 1, x: 0.85, y: 0.3, w: 0.03, h: 0.02, label: 'מאשר/ת קבלת דיוור' }),
    F({ id: 's2', kind: 'signature', signer: 2, page: 1, x: 0.55, y: 0.8, w: 0.35, h: 0.07 }),
    F({ id: 'n2', kind: 'name', signer: 2, page: 1, x: 0.55, y: 0.74, w: 0.35, h: 0.035 }),
  ]
  const api = async (method, p, data) => { const r = await page.request.fetch(BASE + p, { method, data, headers: data ? { 'content-type': 'application/json' } : {} }); return { status: r.status(), body: await r.json().catch(() => ({})) } }
  const noSig2 = await api('POST', '/api/sign/templates', { name: 'שבורה', category: 'bank', fileId: merged.body.fileId, fields: fields.filter((f) => f.id !== 's2') })
  assert(noSig2.status === 422 && /ללווה 2 אין שדה חתימה/.test(noSig2.body.message), 'תבנית בלי חתימה ללווה 2 נדחית')
  const tpl = await api('POST', '/api/sign/templates', { name: 'הסכמה למסירת נתוני אשראי (E2E)', category: 'bank', folder: 'בנק לאומי', fileId: merged.body.fileId, fields })
  assert(tpl.status === 200 && tpl.body.id, 'תבנית נשמרה')
  tplId = tpl.body.id
  const lib = await api('GET', '/api/sign/templates?viewer=dan')
  const t = lib.body.templates.find((x) => x.id === tplId)
  assert(t && t.folder === 'בנק לאומי' && t.signers === 2 && t.page_sizes.length === 2, 'בספרייה: תיקיית בנק לאומי, 2 חותמים, 2 עמודים')

  step('שליחה מתבנית ללקוח — שני חותמים')
  const sent = await api('POST', '/api/sign', { clientDoc: CLIENT, clientName: 'לקוח בדיקה E2E', division: 'finance', title: 'הסכמה למסירת נתוני אשראי', category: 'bank', lender: 'בנק לאומי',
    pdfTemplateId: tplId, signers: [{ label: 'לווה 1', name: 'דנה כהן', email: 'dana@example.com' }, { label: 'לווה 2', name: 'Avi Levi', email: 'avi@example.com' }] })
  assert(sent.status === 200 && sent.body.links?.length === 2, 'נשלח: 2 קישורים אישיים')
  envIds.push(sent.body.envelopeId)
  const [env0] = await sql`select template_key, source_file_id, jsonb_array_length(pdf_fields) n, recipient_kind from sign_envelopes where id = ${sent.body.envelopeId}`
  assert(env0.template_key === 'pdf:' + tplId && env0.n === fields.length && env0.recipient_kind === 'client', 'המעטפה: צילום השדות מהתבנית + המקור')

  step('לווה 1 — הדף בטלפון (390): המסמך, השדות שלו מסומנים, מילוי חי, שדה חובה')
  const sctx = await b.newContext({ viewport: { width: 390, height: 844 } }); await routePdfjs(sctx)
  const sp = await sctx.newPage(); const errs = []; sp.on('pageerror', (e) => errs.push(e.message))
  await sp.goto(sent.body.links[0].url); await sp.waitForTimeout(1500)
  const shown = await sp.evaluate(() => ({ pages: document.querySelectorAll('.pg').length, mine: document.querySelectorAll('.fld:not(.other)').length, other: document.querySelectorAll('.fld.other').length,
    drawn: [...document.querySelectorAll('.pg canvas')].every((c) => c.width > 0), inputs: [...document.querySelectorAll('[data-fid]')].map((i) => i.getAttribute('data-fid')).join(',') }))
  assert(shown.pages === 2 && shown.mine === 6 && shown.other === 2, `2 עמודים · 6 שדות שלי מסומנים · 2 של לווה 2 (${JSON.stringify(shown)})`)
  assert(shown.drawn, 'העמודים צוירו (pdf.js)')
  assert(shown.inputs === 'acc,ok', 'בטופס: מספר חשבון + תיבת סימון')
  await sp.fill('#name', 'דנה כהן'); await sp.fill('#idn', '000000018')
  await sp.locator('#cv').scrollIntoViewIfNeeded(); const pad = await sp.locator('#cv').boundingBox()
  await sp.mouse.move(pad.x + 30, pad.y + 120); await sp.mouse.down()
  for (let k = 0; k <= 30; k++) await sp.mouse.move(pad.x + 30 + k * 9, pad.y + 120 - Math.sin(k / 3) * 40)
  await sp.mouse.up(); await sp.waitForTimeout(200)
  const live = await sp.evaluate(() => ({ filled: document.querySelectorAll('.fld.filled').length, sig: !!document.querySelector('.fld[data-k="signature"]:not(.other) img'), name: document.querySelector('.fld[data-k="name"]:not(.other)').textContent }))
  assert(live.sig && live.name === 'דנה כהן' && live.filled >= 4, `מילוי חי: חתימה, שם, ת"ז, תאריך על המסמך (${live.filled} שדות)`)
  await sp.check('#agree'); await sp.click('#go'); await sp.waitForTimeout(800)
  const reqErr = await sp.locator('#err').innerText()
  assert(/נא למלא: מספר חשבון/.test(reqErr), 'שדה חובה ריק — השרת דוחה: ' + reqErr.replace(/\s+/g, ' '))
  await sp.fill('#v_acc', '123-456789'); await sp.check('[data-fid="ok"]')
  if (OUT) await sp.screenshot({ path: path.join(OUT, 'sign-pdf@390.png'), fullPage: true })
  await sp.click('#go'); await sp.waitForTimeout(1500)
  assert(/נחתם — תודה/.test(await sp.locator('.wrap').innerText()), 'לווה 1 חתם')
  assert(!errs.length, 'בלי שגיאות JS בדף החותם ' + errs.join(' | '))

  step('לווה 2 — חותם; המסמך הושלם')
  const sp2 = await sctx.newPage(); await sp2.goto(sent.body.links[1].url); await sp2.waitForTimeout(1200)
  assert(await sp2.locator('.fld:not(.other)').count() === 2, 'ללווה 2 מסומנים רק 2 השדות שלו')
  await sp2.fill('#name', 'Avi Levi'); await sp2.fill('#idn', '000000026')
  await sp2.locator('#cv').scrollIntoViewIfNeeded(); const pad2 = await sp2.locator('#cv').boundingBox()
  await sp2.mouse.move(pad2.x + 40, pad2.y + 60); await sp2.mouse.down(); for (let k = 0; k <= 25; k++) await sp2.mouse.move(pad2.x + 40 + k * 10, pad2.y + 60 + (k % 5) * 12); await sp2.mouse.up()
  await sp2.check('#agree'); await sp2.click('#go'); await sp2.waitForTimeout(6000)
  const [done] = await sql`select status, pdf_file_id, finalize_error from sign_envelopes where id = ${sent.body.envelopeId}`
  assert(done.status === 'completed' && done.pdf_file_id, 'הושלם, ה-PDF החתום במסד' + (done.finalize_error ? ` (הערה: ${done.finalize_error})` : ''))

  step('ה-PDF החתום: המקור + החתימות והטקסט במקומם + עמוד תיעוד')
  const r = await page.request.get(`${BASE}/api/files/${done.pdf_file_id}`)
  const bytes = Buffer.from(await r.body())
  if (OUT) writeFileSync(path.join(OUT, 'signed.pdf'), bytes)
  const doc = await PDFDocument.load(bytes)
  assert(doc.getPageCount() === 3, `3 עמודים: 2 של הטופס + עמוד תיעוד (${doc.getPageCount()})`)
  const parsed = await new PDFParse({ data: bytes }).getText()
  const text = parsed.text
  assert(text.includes('Bank form A') && text.includes('Bank form B'), 'הטקסט המקורי של הטופס נשמר (לא תמונה)')
  assert(text.includes('000000018') && text.includes('123-456789') && text.includes('Avi Levi'), 'ת"ז, מספר החשבון ושם הלווה השני — טקסט על הטופס')
  assert(text.includes('ןהכ הנד') || text.includes('דנה כהן'), 'השם העברי על הטופס')
  assert(text.includes('עמוד תיעוד חתימה') || text.includes('הדימעת דומע'), 'עמוד התיעוד בסוף')
  const [rowLock] = await sql`select field_values from sign_requests where envelope_id = ${sent.body.envelopeId} and signer_order = 1`
  assert(rowLock.field_values.acc === '123-456789' && rowLock.field_values.ok === '1', 'מה שלווה 1 מילא נשמר (ונעול)')
  const again = await sp.request.post(sent.body.links[0].url.replace('/s/', '/api/s/'), { data: { name: 'x', idNumber: '000000018', signature: 'data:image/png;base64,AA', agree: true } })
  assert(again.status() === 422, 'חתימה חוזרת על אותו קישור נדחית')

  step('מסמך מזדמן למתעניין (ליד): העלאה + שדות → שליחה → מחיקה')
  const single = await up([{ name: 'כתב הרשאה.pdf', b64: (await form('POA')).toString('base64') }])
  fileIds.push(single.body.fileId)
  const adhoc = await api('POST', '/api/sign', { clientDoc: LEAD, clientName: 'מתעניין בדיקה E2E', division: 'finance', title: 'כתב הרשאה ליועץ משכנתאות', category: 'poa', recipientKind: 'lead',
    pdf: { fileId: single.body.fileId, fields: [F({ id: 'x1', kind: 'signature', signer: 1, x: 0.5, y: 0.85, w: 0.4, h: 0.07 }), F({ id: 'x2', kind: 'name', signer: 1, x: 0.1, y: 0.85, w: 0.3, h: 0.04 })] },
    signers: [{ label: 'לווה 1', name: 'מתעניין בדיקה', email: 'lead@example.com' }] })
  assert(adhoc.status === 200, 'מסמך מזדמן נשלח למתעניין')
  envIds.push(adhoc.body.envelopeId)
  const all = await api('GET', '/api/sign?all=1')
  const lr = all.body.envelopes.find((e) => e.id === adhoc.body.envelopeId)
  assert(lr && lr.recipient_kind === 'lead' && lr.pages === 1 && lr.source_file_id, 'ברשימת המסמכים: מתעניין, PDF של עמוד אחד')
  const [leadDoc] = await sql`select data->'log'->0->>'text' t from crm_docs where coll = 'leads' and doc_id = ${LEAD}`
  assert(/נשלח לחתימה: כתב הרשאה/.test(leadDoc.t), 'נרשם ביומן הליד: ' + leadDoc.t)
  const del = await api('POST', `/api/sign/${adhoc.body.envelopeId}`, { action: 'delete' })
  const all2 = await api('GET', '/api/sign?all=1')
  assert(del.body.ok && !all2.body.envelopes.some((e) => e.id === adhoc.body.envelopeId), 'נמחק (הוסתר) מהרשימה')
  const dead = await sctx.newPage(); await dead.goto(adhoc.body.links[0].url)
  assert(/בוטל|לא נמצא/.test(await dead.locator('body').innerText()), 'הקישור של מסמך שנמחק לא פעיל')

  const top = (await api('GET', '/api/sign/templates?viewer=dan')).body.top
  assert(top.some((x) => x.id === tplId && x.n === 1), '"התבניות הכי פעילות" סופרת את השליחה')
  console.log('\n✓ טפסים מ-PDF עובדים מקצה לקצה.')
} finally {
  // ניקוי — הכל סינתטי. מסמכים חתומים לא נמחקים פיזית (אילוץ) — רק מוסתרים.
  for (const id of envIds) await sql`update sign_envelopes set deleted_at = coalesce(deleted_at, now()) where id = ${id}`.catch(() => {})
  for (const id of envIds) await sql`update sign_requests set deleted_at = coalesce(deleted_at, now()) where envelope_id = ${id}`.catch(() => {})
  if (tplId) await sql`update sign_templates set deleted_at = now() where id = ${tplId}`.catch(() => {})
  await sql`update crm_docs set deleted_at = now() where (coll, doc_id) in (('clients', ${CLIENT}), ('leads', ${LEAD}))`.catch(() => {})
  await sql.end(); await b.close()
}
