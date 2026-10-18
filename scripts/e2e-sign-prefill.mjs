/**
 * בדיקת קצה-לקצה — חתימות: מילוי מהתיק, שליחה מהירה, הערות, מסירה ללקוח ותיעוד הזיהוי (דן, 17/10):
 *   טופס PDF עם שדות "מילוי מהתיק" → ★ שליחה מהירה מכרטיס הלקוח → הערות → חלון "איך זה מגיע ללקוח"
 *   (קישור, וואטסאפ, מצב המייל) → בדף החותם: שם, ת"ז והשדות כבר ממולאים, ההערות מוצגות →
 *   לווה 1 חותם כמו שמולא; לווה 2 מזין ת"ז אחרת מהכרטיס → התרעה בכרטיס → עמוד התיעוד: ציר זמן
 *   (פתיחה, IP, מכשיר), פרטים מול הכרטיס, הערות → טביעת הקובץ החתום במייל למשרד · קישור חדש בלי מייל.
 * נתונים סינתטיים בלבד (מיילים ב-example.com, ת"ז בדיקה). מנקה אחריו.
 *
 *   BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-sign-prefill.mjs
 */
import { chromium } from 'playwright'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { PDFParse } from 'pdf-parse'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const OUT = process.env.E2E_OUT ?? null
const shot = async (pg, name) => { if (OUT) await pg.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }) }
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const url = process.env.DATABASE_URL || env.DATABASE_URL
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const CLIENT = 'e2e-prefill-client', LEAD = 'e2e-prefill-lead'

async function form(title) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([595.28, 841.89]).drawText(`${title} (synthetic test form)`, { x: 50, y: 790, size: 14, font })
  return Buffer.from(await doc.save())
}

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const routePdfjs = async (ctx) => {
  const dir = process.env.PDFJS_DIR
  if (dir) await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', (r) => r.fulfill({ body: readFileSync(path.join(dir, r.request().url().includes('worker') ? 'pdf.worker.min.js' : 'pdf.min.js'), 'utf8'), contentType: 'text/javascript' }))
}
// כניסה כדן (כמו הדף אחרי סיסמה): עוגיית המשתמש + שער המשרד
const staff = await b.newContext({ viewport: { width: 1280, height: 900 } }); await routePdfjs(staff)
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await staff.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await staff.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const pageErrs = []; page.on('pageerror', (e) => pageErrs.push(e.message))
let envIds = [], tplId = null, quickBefore = null
try {
  await sql`insert into crm_docs (coll, doc_id, data) values ('clients', ${CLIENT}, ${sql.json({ id: CLIENT, name: 'דנה כהן', idNumber: '000000018', email: 'dana@example.com', phone: '0521234567', address: 'הרצל 1, רמת גן',
    spouseName: 'Avi Levi', spouseId: '000000026', spouseEmail: 'avi@example.com', division: 'finance', status: 'active', product: 'mortgage', baseAmount: 1200000, log: [] })})
    on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  const api = async (method, p, data) => { const r = await page.request.fetch(BASE + p, { method, data, headers: data ? { 'content-type': 'application/json' } : {} }); return { status: r.status(), body: await r.json().catch(() => ({})) } }

  step('טופס PDF בספרייה: שם/ת"ז לכל לווה, מייל וסכום "מילוי מהתיק", שדה הערות')
  const upl = await page.evaluate(async ({ b64, base }) => { const fd = new FormData(); fd.append('file', new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'שירותים.pdf', { type: 'application/pdf' }))
    const r = await fetch(base + '/api/sign/files', { method: 'POST', body: fd }); return r.json() }, { b64: (await form('Service agreement')).toString('base64'), base: BASE })
  const F = (o) => ({ page: 0, w: 0.3, h: 0.035, signer: 1, ...o })
  const fields = [
    F({ id: 's1', kind: 'signature', x: 0.55, y: 0.85, w: 0.35, h: 0.07 }), F({ id: 'n1', kind: 'name', x: 0.55, y: 0.8 }), F({ id: 'i1', kind: 'id_number', x: 0.1, y: 0.8 }),
    F({ id: 'em', kind: 'text', x: 0.1, y: 0.3, src: 'signer_email', label: 'מייל' }), F({ id: 'amt', kind: 'text', x: 0.1, y: 0.35, src: 'amount', label: 'סכום' }),
    F({ id: 'nt', kind: 'text', x: 0.1, y: 0.45, w: 0.8, src: 'notes', label: 'הערות' }),
    F({ id: 's2', kind: 'signature', signer: 2, x: 0.55, y: 0.6, w: 0.35, h: 0.07 }), F({ id: 'n2', kind: 'name', signer: 2, x: 0.55, y: 0.55 }), F({ id: 'i2', kind: 'id_number', signer: 2, x: 0.1, y: 0.55 }),
  ]
  const tpl = await api('POST', '/api/sign/templates', { name: 'הסכם שירותים (E2E)', category: 'agreement', fileId: upl.fileId, fields, requireOtp: true })
  assert(tpl.status === 200, 'הטופס נשמר'); tplId = tpl.body.id
  const t = (await api('GET', '/api/sign/templates?viewer=dan')).body.templates.find((x) => x.id === tplId)
  assert(t.fields.find((f) => f.id === 'em').src === 'signer_email' && t.fields.find((f) => f.id === 'nt').src === 'notes', '"מילוי מהתיק" נשמר בשדות הטופס')

  step('★ שמירה לשליחה מהירה, וכפתור בכרטיס הלקוח')
  quickBefore = await page.evaluate(() => S.settings.signQuick || null)
  await page.evaluate(async (id) => { S.pdfTpls = null; await pdfTplLoad(true); await signQuickToggle('pdf:' + id) }, tplId)
  await page.waitForFunction((id) => (S.settings.signQuick || []).includes('pdf:' + id), tplId, { timeout: 10000 })
  await page.evaluate((id) => go('client', id), CLIENT); await page.waitForTimeout(1500)
  const qb = page.locator(`[data-signquick="pdf:${tplId}"]`)
  assert(await qb.count() === 1, 'בכרטיס: "שליחה מהירה — הסכם שירותים (E2E)"')
  await qb.click(); await page.waitForTimeout(400)
  const drawerTxt = await page.locator('.drawer').innerText()
  assert(/ימולא מהתיק: .*ת״ז 000000018/.test(drawerTxt) && /ת״ז 000000026/.test(drawerTxt), 'במגירה: לכל לווה — מה ימולא מהתיק (שם, ת״ז, מייל, סכום)')
  await page.fill('.drawer textarea[name="notes"]', 'הנחה מיוחדת: 500 ₪ משכר הטרחה\nבתוקף עד סוף החודש')
  await shot(page, 'sign-quick@1280')
  await page.click('#dsave'); await page.waitForTimeout(2500)

  step('"איך זה מגיע ללקוח": קישור לכל לווה, וואטסאפ, ומצב המייל האמיתי')
  await shot(page, 'sign-result@1280')
  const res = await page.locator('.drawer').innerText()
  const urls = await page.$$eval('.drawer input[readonly]', (xs) => xs.map((x) => x.value))
  const was = await page.$$eval('.drawer a[href^="https://wa.me/"]', (xs) => xs.map((x) => x.getAttribute('href')))
  assert(urls.length === 2 && urls.every((u) => /\/s\/[A-Za-z0-9_-]{20,}$/.test(u)), '2 קישורים אישיים')
  assert(was.length === 2 && was[0].startsWith('https://wa.me/972521234567?text=') && decodeURIComponent(was[0]).includes(urls[0]), 'וואטסאפ ללקוחה עם הקישור שלה')
  assert(/המייל ממתין|נשלח במייל/.test(res), 'מצב המייל מוצג (' + (res.match(/המייל ממתין|נשלח במייל ✓/) || [''])[0] + ')')
  const [env1] = await sql`select e.id from sign_envelopes e where e.client_doc = ${CLIENT} and e.deleted_at is null order by e.created_at desc limit 1`
  envIds.push(env1.id)
  const reqs = await sql`select signer_order, fields, doc_hash from sign_requests where envelope_id = ${env1.id} order by signer_order`
  assert(reqs[0].fields['@prefill'].idNumber === '000000018' && reqs[0].fields['@prefill'].values.em === 'dana@example.com' && /1,200,000/.test(reqs[0].fields['@prefill'].values.amt), 'נשמר: ת"ז, מייל וסכום מהתיק ללווה 1')
  assert(reqs[1].fields['@prefill'].name === 'Avi Levi' && reqs[1].fields['@prefill'].idNumber === '000000026', 'ללווה 2: בן הזוג מהכרטיס')
  assert(/500 ₪/.test(reqs[0].fields['@notes']), 'ההערות נשמרו עם המסמך')
  assert(reqs[0].fields['@events'][0].kind === 'sent' && /ע"י דן/.test(reqs[0].fields['@events'][0].detail), 'תיעוד: נשלח ע"י דן, לאן')
  await page.click('.drawer [data-close]').catch(() => {})

  step('לווה 1 — בטלפון: הכל כבר ממולא, ההערות מוצגות; חותמת כמו שמולא')
  const sctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1' }); await routePdfjs(sctx)
  const sp = await sctx.newPage(); const errs = []; sp.on('pageerror', (e) => errs.push(e.message))
  await sp.goto(urls[0]); await sp.waitForTimeout(1500)
  const pre = await sp.evaluate(() => ({ name: document.querySelector('#name').value, id: document.querySelector('#idn').value, em: document.querySelector('#v_em').value, amt: document.querySelector('#v_amt').value,
    nt: document.querySelector('#v_nt').value, ntRo: document.querySelector('#v_nt').readOnly, notes: (document.querySelector('.notes') || {}).textContent || '', hint: document.querySelectorAll('.pre').length,
    onDoc: document.querySelector('.fld[data-k="name"]:not(.other)').textContent, otp: !!document.querySelector('#otp') }))
  assert(pre.name === 'דנה כהן' && pre.id === '000000018' && pre.em === 'dana@example.com' && /1,200,000/.test(pre.amt), 'שם, ת"ז, מייל וסכום — ממולאים מהתיק')
  assert(pre.ntRo && /500 ₪/.test(pre.nt) && /בתוקף עד סוף החודש/.test(pre.notes), 'ההערות: בכרטיס "הערות למסמך" + בשדה בטופס, לקריאה בלבד')
  assert(pre.hint >= 3 && pre.onDoc === 'דנה כהן', 'סימון "מולא מראש מהתיק — נא לבדוק" + השם כבר על המסמך')
  await shot(sp, 'sign-prefilled@390')
  const sign = async (pg) => { await pg.locator('#cv').scrollIntoViewIfNeeded(); const pad = await pg.locator('#cv').boundingBox(); await pg.mouse.move(pad.x + 30, pad.y + 100); await pg.mouse.down()
    for (let k = 0; k <= 30; k++) await pg.mouse.move(pad.x + 30 + k * 9, pad.y + 100 - Math.sin(k / 3) * 40); await pg.mouse.up(); await pg.check('#agree'); await pg.click('#go'); await pg.waitForTimeout(1800) }
  if (pre.otp) {
    // קוד אימות דרוש (גוגל מחובר בסביבה הזו) — הקוד מגיע לתיבת היוצא; הבדיקה קוראת אותו משם
    await sp.click('#otpSend'); await sp.waitForTimeout(800)
    const [o] = await sql`select subject from outbox where target = 'dana@example.com' and subject like 'קוד אימות%' order by created_at desc limit 1`
    await sp.fill('#otpCode', o.subject.match(/\d{6}/)[0]); await sp.click('#otpGo'); await sp.waitForTimeout(800)
  }
  await sign(sp)
  assert(/נחתם — תודה/.test(await sp.locator('.wrap').innerText()), 'לווה 1 חתמה')
  assert(!errs.length, 'בלי שגיאות JS בדף החותם ' + errs.join(' | '))

  step('לווה 2 — מזין ת"ז אחרת מהכרטיס: נחתם, ומסומן לבדיקה')
  const sp2 = await sctx.newPage(); await sp2.goto(urls[1]); await sp2.waitForTimeout(1200)
  if (await sp2.locator('#otp').count()) { await sp2.click('#otpSend'); await sp2.waitForTimeout(800); const [o] = await sql`select subject from outbox where target = 'avi@example.com' and subject like 'קוד אימות%' order by created_at desc limit 1`; await sp2.fill('#otpCode', o.subject.match(/\d{6}/)[0]); await sp2.click('#otpGo'); await sp2.waitForTimeout(800) }
  await sp2.fill('#idn', '000000034'); await sign(sp2); await sp2.waitForTimeout(5000)
  const [cl] = await sql`select data->'log' log from crm_docs where coll = 'clients' and doc_id = ${CLIENT}`
  assert(cl.log.some((l) => /⚠️ Avi Levi חתם\/ה .*ת"ז שונה מהכרטיס/.test(l.text)), 'בכרטיס: ⚠️ ת"ז שונה מהכרטיס — נא לבדוק')
  const sg = await sql`select signer_order, fields->'@events' ev, signer_ip, signer_id_number from sign_requests where envelope_id = ${env1.id} order by signer_order`
  const kinds = sg[0].ev.map((e) => e.kind)
  assert(kinds.includes('opened') && kinds.at(-1) === 'signed' && sg[0].ev.find((e) => e.kind === 'opened').ua.includes('iPhone'), 'ציר הזמן של לווה 1: ' + kinds.join(' → '))
  assert(/ת"ז שונה מהכרטיס/.test(sg[1].ev.at(-1).detail), 'בחתימה של לווה 2 נרשם: ת"ז שונה מהכרטיס')

  step('ה-PDF החתום: הערות בשדה, עמוד תיעוד עם ציר זמן ופרטים מול הכרטיס; טביעת הקובץ במייל למשרד')
  const [done] = await sql`select e.status, e.pdf_file_id, f.sha256 from sign_envelopes e left join stored_files f on f.id = e.pdf_file_id where e.id = ${env1.id}`
  assert(done.status === 'completed' && done.pdf_file_id, 'הושלם, ה-PDF במסד')
  const bytes = Buffer.from(await (await page.request.get(`${BASE}/api/files/${done.pdf_file_id}`)).body())
  const text = (await new PDFParse({ data: bytes }).getText()).text
  assert(text.includes('dana@example.com') && text.includes('000000018'), 'המייל ות"ז מהתיק — על הטופס')
  const has = (s) => text.includes(s) || text.includes([...s].reverse().join(''))
  assert(has('ציר הזמן') && has('פרטים בתיק לפני החתימה') && has('הערות השולח'), 'עמוד התיעוד: ציר זמן, פרטים מול הכרטיס, הערות')
  assert(text.includes('iPhone'), 'עמוד התיעוד: המכשיר (iPhone · Safari)')
  const [own] = await sql`select body from outbox where dedup_key = ${'sign-done-owner:' + env1.id}`
  assert(!own || own.body.includes(done.sha256), 'במייל למשרד: טביעת הקובץ החתום (SHA-256)' + (own ? '' : ' — אין מייל משרד מוגדר, דילוג'))

  step('קישור חדש בלי מייל (להעתקה / וואטסאפ) — הקודם מפסיק לעבוד, נרשם בתיעוד')
  const s2 = await api('POST', '/api/sign', { clientDoc: CLIENT, clientName: 'דנה כהן', division: 'finance', title: 'הסכמה (E2E)', category: 'general', pdfTemplateId: tplId, notes: 'בדיקה',
    signers: [{ label: 'לווה 1', name: 'דנה כהן', email: 'dana@example.com' }, { label: 'לווה 2', name: 'Avi Levi', phone: '0527654321' }] })
  envIds.push(s2.body.envelopeId)
  const ln = await api('POST', `/api/sign/${s2.body.links[1].id}`, { action: 'link' })
  assert(ln.status === 200 && ln.body.url && ln.body.emailQueued === false, 'קישור חדש — בלי מייל')
  const old = await sctx.newPage(); await old.goto(s2.body.links[1].url)
  assert(/לא נמצא|בוטל|פג/.test(await old.locator('body').innerText()), 'הקישור הקודם לא עובד')
  const [ev2] = await sql`select fields->'@events' ev from sign_requests where id = ${s2.body.links[1].id}`
  assert(ev2.ev.some((e) => e.kind === 'link_renewed'), 'בתיעוד: קישור חדש')
  step('מתעניין (ליד): "שלח לחתימה" בראש הכרטיס → שליחה מהירה → החותם רואה את שמו ממולא')
  await page.evaluate(async (id) => { await write('leads/' + id, { id, name: 'מתעניין בדיקה', phone: '0501112233', email: 'lead@example.com', idNumber: '000000042', division: 'finance', stage: 'new', createdAt: stamp(), updatedAt: stamp(), log: [] }) }, LEAD)
  await page.waitForFunction((id) => S.leads.has(id), LEAD, { timeout: 15000 })
  await page.evaluate((id) => go('lead', id), LEAD); await page.waitForTimeout(1200)
  await page.click('[data-act="toSign"]'); await page.waitForTimeout(500)
  assert(await page.locator('#signcard').isVisible() && /למתעניין/.test(await page.locator('#signcard h2').innerText()), 'בכרטיס הליד: "מסמכים לחתימה · למתעניין" נפתח')
  await page.click(`#signcard [data-signquick="pdf:${tplId}"]`); await page.waitForTimeout(400)
  assert(/ת״ז 000000042/.test(await page.locator('.drawer').innerText()), 'במגירה: ת״ז מהליד')
  // טופס לשני לווים — בלי פרטים ללווה 2 השליחה נעצרת עם הודעה ברורה; ממלאים טלפון ושולחים
  await page.click('#dsave'); await page.waitForTimeout(800)
  assert(/לווה 2: חסר מייל או טלפון/.test(await page.locator('#derr').innerText()), 'בלי פרטים ללווה 2 — "לווה 2: חסר מייל או טלפון"')
  await page.fill('.drawer input[name="name1"]', 'בן זוג בדיקה'); await page.fill('.drawer input[name="phone1"]', '0503334455')
  await page.click('#dsave'); await page.waitForTimeout(2500)
  const lurls = await page.$$eval('.drawer input[readonly]', (xs) => xs.map((x) => x.value))
  assert(lurls.length === 2, 'קישורים למתעניין מוכנים')
  const [lenv] = await sql`select id, recipient_kind from sign_envelopes where client_doc = ${LEAD} and deleted_at is null order by created_at desc limit 1`
  envIds.push(lenv.id)
  assert(lenv.recipient_kind === 'lead', 'המסמך נרשם כמתעניין (לא לקוח)')
  const [ll] = await sql`select data->'log'->0->>'text' t from crm_docs where coll = 'leads' and doc_id = ${LEAD}`
  assert(/נשלח לחתימה/.test(ll.t), 'ביומן הליד: ' + ll.t)
  const lp = await sctx.newPage(); await lp.goto(lurls[0]); await lp.waitForTimeout(800)
  assert(await lp.inputValue('#name') === 'מתעניין בדיקה' && await lp.inputValue('#idn') === '000000042', 'בדף החותם: שם ות״ז של המתעניין ממולאים')
  assert(!pageErrs.length, 'בלי שגיאות JS בדף ה-CRM ' + pageErrs.join(' | '))
  console.log('\n✓ מילוי מהתיק, שליחה מהירה, הערות, מסירה ותיעוד — עובדים מקצה לקצה.')
} finally {
  for (const id of envIds) await sql`update sign_envelopes set deleted_at = coalesce(deleted_at, now()) where id = ${id}`.catch(() => {})
  for (const id of envIds) await sql`update sign_requests set deleted_at = coalesce(deleted_at, now()) where envelope_id = ${id}`.catch(() => {})
  if (tplId) await sql`update sign_templates set deleted_at = now() where id = ${tplId}`.catch(() => {})
  await sql`update crm_docs set data = data || ${sql.json({ signQuick: quickBefore ?? [] })} where coll = 'settings' and doc_id = 'main'`.catch(() => {})
  await sql`update crm_docs set deleted_at = now() where (coll, doc_id) in (('clients', ${CLIENT}), ('leads', ${LEAD}))`.catch(() => {})
  await sql.end(); await b.close()
}
