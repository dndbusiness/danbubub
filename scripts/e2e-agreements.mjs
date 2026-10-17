/**
 * בדיקת קצה-לקצה — ספריית ההסכמים (data/agreements):
 *   טעינה ל-settings.signLibrary (כטיוטה) → טעינה חוזרת = אין שינוי → שליחת טיוטה נדחית בשרת →
 *   "אשר נוסח" → שליחה ללקוח (שדות מהכרטיס + הקליטה) → הלקוח חותם בטלפון (390) → PDF חתום במסד →
 *   הסכם עם שדה רשות (בן/בת זוג) נשלח בלי בן זוג → ביטול. נתונים סינתטיים בלבד; מנקה אחריו.
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=… node scripts/e2e-agreements.mjs
 */
import { chromium } from 'playwright'
import { PDFParse } from 'pdf-parse'
import { readFileSync, existsSync } from 'node:fs'
import postgres from 'postgres'
import { unlockGate } from './lib/gate.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
let url = process.env.DATABASE_URL
if (!url && existsSync('.env.local')) url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const LIB_DRAFT = '[טיוטה — נוסח מספריית ההסכמים. לא נשלח ללקוח עד שדן מאשר בהגדרות ← "אשר נוסח"]'

const CLIENT = 'e2e-agr-client'
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const staff = await b.newContext()
const page = await staff.newPage()
const api = async (method, p, data) => { const r = await page.request.fetch(BASE + p, { method, data, headers: data ? { 'content-type': 'application/json' } : {} }); return { status: r.status(), body: await r.json().catch(() => ({})) } }
const [settings0] = await sql`select data from crm_docs where coll = 'settings' and doc_id = 'main' and deleted_at is null`
const envIds = []
try {
  await unlockGate(page, BASE)
  await sql`insert into crm_docs (coll, doc_id, data) values
    ('clients', ${CLIENT}, ${sql.json({ id: CLIENT, name: 'לקוח בדיקה E2E', division: 'finance', product: 'car_loan', feePct: 0.08, phone: '0500000000', email: 'agr-client@example.com', idNumber: '000000018', address: 'רחוב הבדיקה 1, עיר', log: [] })}),
    ('intakes', ${CLIENT}, ${sql.json({ id: CLIENT, clientId: CLIENT, car: { maker: 'טויוטה', model: 'קורולה', year: 2019, plate: '1234567' } })})
    on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
  if (!settings0) await sql`insert into crm_docs (coll, doc_id, data) values ('settings', 'main', ${sql.json({})}) on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
  else await sql`update crm_docs set data = data - 'signLibrary' where coll = 'settings' and doc_id = 'main'`

  step('תצוגה מקדימה: כל ההסכמים בקבצים, כל אחד "נוסף כטיוטה"')
  const plan = await api('GET', '/api/sign/library')
  assert(plan.status === 200 && plan.body.templates.length >= 9 && !plan.body.errors.length, `${plan.body.templates?.length} הסכמים בספרייה, בלי שגיאות`)
  assert(plan.body.report.every((r) => r.action === 'added'), 'בטעינה הראשונה — הכל חדש')

  step('טעינה → settings.signLibrary; טעינה חוזרת = אין שינוי')
  const load1 = await api('POST', '/api/sign/library', {})
  assert(load1.status === 200 && load1.body.written, 'נטען')
  const [s1] = await sql`select data->'signLibrary' lib, seq from crm_docs where coll = 'settings' and doc_id = 'main'`
  assert(s1.lib.length === plan.body.templates.length && s1.lib.every((x) => x.body.startsWith(LIB_DRAFT) && x.lib), 'כל ההסכמים בהגדרות, כולם טיוטה')
  const load2 = await api('POST', '/api/sign/library', {})
  const [s2] = await sql`select data->'signLibrary' lib, seq from crm_docs where coll = 'settings' and doc_id = 'main'`
  assert(load2.status === 200 && !load2.body.written && load2.body.report.every((r) => r.action === 'unchanged') && String(s2.seq) === String(s1.seq), 'טעינה חוזרת: 0 שינויים, ההגדרות לא נכתבו')

  const car = s1.lib.find((x) => x.key === 'lib:finance-car-credit')
  const fields = { company: 'הר-אל פתרונות מימון', date: '17.10.2026', client_name: 'לקוח בדיקה E2E', client_id: '000000018', client_phone: '0500000000', client_email: 'agr-client@example.com',
    client_address: 'רחוב הבדיקה 1, עיר', submit_days: '5', fee_percent: '8', car_model: 'טויוטה קורולה', car_plate: '1234567', car_year: '2019' }
  const send = (tpl, extra = {}) => api('POST', '/api/sign', { clientDoc: CLIENT, clientName: 'לקוח בדיקה E2E', division: 'finance', title: tpl.title, template: tpl.body, category: tpl.category, templateKey: tpl.key,
    fields, signers: [{ label: 'הלקוח', name: 'לקוח בדיקה E2E', email: 'agr-client@example.com' }], ...extra })

  step('שליחה של טיוטה — השרת דוחה (גם אם הדף לא חסם)')
  const draftSend = await send(car)
  assert(draftSend.status === 422 && /טיוטה/.test(draftSend.body.message), 'נדחה: ' + draftSend.body.message)

  step('"אשר נוסח" (כמו הכפתור בהגדרות) → אפשר לשלוח')
  const approved = s1.lib.map((x) => (x.key === car.key || x.key === 'lib:finance-mortgage-refinance' ? { ...x, body: x.body.slice(LIB_DRAFT.length).replace(/^\n+/, ''), approvedAt: new Date().toISOString(), approvedBy: 'e2e', approvedVersion: x.libVersion } : x))
  const w = await api('POST', '/api/crm/write', { path: 'settings/main', op: 'update', data: { signLibrary: approved } })
  assert(w.status === 200, 'האישור נשמר')
  const load3 = await api('POST', '/api/sign/library', {})
  assert(!load3.body.written, 'טעינה אחרי אישור לא מחזירה את ההסכם לטיוטה')
  const carOk = approved.find((x) => x.key === car.key)

  step('חסר שדה (מספר רישוי) — השרת מחזיר מה חסר')
  const miss = await send(carOk, { fields: { ...fields, car_plate: '' } })
  assert(miss.status === 422 && miss.body.missing?.includes('car_plate'), 'חסר: ' + (miss.body.missing || []).join(','))

  step('שליחה ללקוח — הסכם רכב, השדות מהכרטיס ומהקליטה')
  const sent = await send(carOk)
  assert(sent.status === 200 && sent.body.links?.length === 1, 'נשלח: קישור אישי')
  envIds.push(sent.body.envelopeId)
  const [req] = await sql`select body_html from sign_requests where envelope_id = ${sent.body.envelopeId}`
  assert(req.body_html.includes('<b>1234567</b>') && req.body_html.includes('<b>8</b>%') && !req.body_html.includes('טיוטה —'), 'הנוסח שנשמר: מספר הרכב, 8%, בלי סימון טיוטה')

  step('הלקוח חותם בטלפון (390)')
  const sctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  const sp = await sctx.newPage(); const errs = []; sp.on('pageerror', (e) => errs.push(e.message))
  await sp.goto(sent.body.links[0].url); await sp.waitForTimeout(800)
  const txt = await sp.locator('body').innerText()
  assert(txt.includes('ליווי בגיוס אשראי כנגד שעבוד רכב') && txt.includes('טויוטה קורולה'), 'הנוסח מוצג לחותם עם פרטי הרכב')
  const wide = await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  assert(wide, 'אין גלילה אופקית ב-390')
  await sp.fill('#name', 'לקוח בדיקה E2E'); await sp.fill('#idn', '000000018')
  await sp.locator('#cv').scrollIntoViewIfNeeded(); const pad = await sp.locator('#cv').boundingBox()
  await sp.mouse.move(pad.x + 30, pad.y + 60); await sp.mouse.down()
  for (let k = 0; k <= 30; k++) await sp.mouse.move(pad.x + 30 + k * 9, pad.y + 60 - Math.sin(k / 3) * 30)
  await sp.mouse.up(); await sp.check('#agree'); await sp.click('#go'); await sp.waitForTimeout(6000)
  assert(!errs.length, 'בלי שגיאות JS בדף החותם ' + errs.join(' | '))
  const [done] = await sql`select status, pdf_file_id, finalize_error from sign_envelopes where id = ${sent.body.envelopeId}`
  assert(done.status === 'completed', 'המסמך נחתם')
  if (done.pdf_file_id) {
    const r = await page.request.get(`${BASE}/api/files/${done.pdf_file_id}`)
    const text = (await new PDFParse({ data: Buffer.from(await r.body()) }).getText()).text
    assert(text.includes('1234567') && text.includes('000000018'), 'PDF חתום במסד: מספר הרכב ות"ז החותם')
  } else console.log(`! ה-PDF לא נוצר בסביבה הזו (${done.finalize_error}) — "צור PDF שוב" בכרטיס`)
  const [ob] = await sql`select count(*)::int n from outbox where dedup_key like ${'sign-invite:%'} and target = 'agr-client@example.com'`
  assert(ob.n >= 1, 'ההזמנה במייל נכנסה ל-outbox (הנחיה 16)')

  step('שדה רשות: מחזור משכנתא בלי בן/בת זוג — נשלח; ואז ביטול')
  const ref = approved.find((x) => x.key === 'lib:finance-mortgage-refinance')
  const r2 = await send(ref, { fields: { ...fields, fee: '4,000 ₪ + מע״מ', payment_option: 'חלופה ב׳' } })
  assert(r2.status === 200, 'נשלח בלי בן/בת זוג')
  envIds.push(r2.body.envelopeId)
  const [q2] = await sql`select body_html from sign_requests where envelope_id = ${r2.body.envelopeId}`
  assert(q2.body_html.includes('מזמין 2: —'), 'בן/בת זוג ריק מוצג "—"')
  const c = await api('POST', `/api/sign/${r2.body.envelopeId}`, { action: 'cancel' })
  const [e2] = await sql`select status from sign_envelopes where id = ${r2.body.envelopeId}`
  assert(e2.status === 'cancelled', 'בוטל (' + c.status + ')')
  console.log('\nהכל עבר ✓')
} finally {
  // ניקוי — הכל סינתטי. מסמכים חתומים לא נמחקים פיזית (אילוץ) — רק מוסתרים. ההגדרות חוזרות למה שהיה.
  for (const id of envIds) await sql`update sign_envelopes set deleted_at = coalesce(deleted_at, now()) where id = ${id}`.catch(() => {})
  for (const id of envIds) await sql`update sign_requests set deleted_at = coalesce(deleted_at, now()) where envelope_id = ${id}`.catch(() => {})
  await sql`update crm_docs set deleted_at = now() where (coll, doc_id) in (('clients', ${CLIENT}), ('intakes', ${CLIENT}))`.catch(() => {})
  if (settings0) await sql`update crm_docs set data = ${sql.json(settings0.data)} where coll = 'settings' and doc_id = 'main'`.catch(() => {})
  else await sql`update crm_docs set deleted_at = now() where coll = 'settings' and doc_id = 'main'`.catch(() => {})
  await b.close(); await sql.end()
}
