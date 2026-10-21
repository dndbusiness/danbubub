/**
 * בדיקת קצה-לקצה — טפסי הגופים עם שדות מוכנים (דן, 21/10: "העליתי טפסים — שזה כבר ייכנס"):
 *   טופס שכבר בספרייה "לבדיקה" עם שדות מנוחשים → טעינת הספרייה מחליפה לשדות המוכנים ומורידה "לבדיקה" ·
 *   "📥 ייבוא מדרייב" של אותו קובץ → נכנס עם השדות המוכנים, בלי "לבדיקה" · סינון לפי סוג + "סמן את כל ה-N" ·
 *   פרטי היועץ מההגדרות נכנסים לטופס (לקריאה בלבד אצל החותם) · טופס לשני לווים נשלח ללקוח עם לווה אחד.
 * נתונים סינתטיים בלבד (טופס שנוצר כאן, דרייב מדומה). מנקה אחריו.
 *
 *   השרת צריך לרוץ עם SIGN_CURATED_EXTRA=<נתיב> (אותו נתיב כאן) — הבדיקה כותבת לשם את השדות המוכנים של הטופס הסינתטי:
 *   SIGN_CURATED_EXTRA=/tmp/curated-e2e.json npm start
 *   SIGN_CURATED_EXTRA=/tmp/curated-e2e.json BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-sign-curated.mjs
 *   PDFJS_DIR=<תיקייה עם pdf.min.js ו-pdf.worker.min.js 3.11.174> — כשאין גישה ל-cdnjs
 */
import { chromium } from 'playwright'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const EXTRA = process.env.SIGN_CURATED_EXTRA
if (!EXTRA) { console.error('SIGN_CURATED_EXTRA לא מוגדר (אותו נתיב שהשרת קיבל)'); process.exit(1) }
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const url = process.env.DATABASE_URL || env.DATABASE_URL
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const CLIENT = 'e2e-curated-client'

// טופס סינתטי בסגנון כתב הסמכה: טבלה לשני לווים, טבלת יועץ, שורת חתימות. בלי תוויות שהזיהוי האוטומטי מכיר — כמו הטפסים המקודדים של הגופים
async function form() {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(path.join('assets', 'fonts', 'DejaVuSans.ttf')), { subset: true })
  const T = new Date('2026-01-01T00:00:00Z'); doc.setCreationDate(T); doc.setModificationDate(T); doc.setProducer('e2e'); doc.setCreator('e2e')
  const p = doc.addPage([595.28, 841.89])
  p.drawText('E2E authorization form', { x: 200, y: 780, size: 16, font })
  const box = (x, y, w, h) => p.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.8 })
  for (const y of [700, 676]) { box(300, y, 220, 24); box(80, y, 220, 24) }
  box(300, 600, 220, 24); box(80, 600, 220, 24)
  for (const y of [200, 176]) { box(380, y, 140, 24); box(200, y, 180, 24); box(80, y, 120, 24) }
  return Buffer.from(await doc.save())
}
const bytes = await form(), sha = createHash('sha256').update(bytes).digest('hex')
const bytes2 = await form()
if (createHash('sha256').update(bytes2).digest('hex') !== sha) { console.error('הטופס הסינתטי לא יציב (טביעה משתנה)'); process.exit(1) }
// y מהחלק העליון: 1 - (y_pdf + h) / H
const Y = (yPdf) => +(1 - (yPdf + 24) / 841.89 + 0.004).toFixed(4), X = (x) => +(x / 595.28 + 0.004).toFixed(4), W = (w) => +(w / 595.28 - 0.008).toFixed(4)
const FIELDS = [
  { page: 0, kind: 'name', signer: 1, x: X(300), y: Y(700), w: W(220), h: 0.02 }, { page: 0, kind: 'id_number', signer: 1, x: X(80), y: Y(700), w: W(220), h: 0.02 },
  { page: 0, kind: 'name', signer: 2, x: X(300), y: Y(676), w: W(220), h: 0.02 }, { page: 0, kind: 'id_number', signer: 2, x: X(80), y: Y(676), w: W(220), h: 0.02 },
  { page: 0, kind: 'text', signer: 1, src: 'advisor_name', label: 'שם היועץ', x: X(300), y: Y(600), w: W(220), h: 0.02 },
  { page: 0, kind: 'text', signer: 1, src: 'advisor_id', label: 'מספר מזהה של היועץ', x: X(80), y: Y(600), w: W(220), h: 0.02 },
  { page: 0, kind: 'signature', signer: 1, x: X(200), y: Y(200), w: W(180), h: 0.022 }, { page: 0, kind: 'date', signer: 1, x: X(80), y: Y(200), w: W(120), h: 0.02 },
  { page: 0, kind: 'signature', signer: 2, x: X(200), y: Y(176), w: W(180), h: 0.022 }, { page: 0, kind: 'date', signer: 2, x: X(80), y: Y(176), w: W(120), h: 0.02 },
]
writeFileSync(EXTRA, JSON.stringify({ forms: [{ sha256: sha, name: 'כתב הסמכה - גוף E2E', folder: 'גוף E2E', type: 'poa', category: 'poa', pages: 1, fields: FIELDS }] }))

const OLD = 'כתב הסמכה ישן E2E', NEW = 'כתב הסמכה - גוף E2E', NAMES = [OLD, NEW]
const DRIVE = { ROOT_CUR_0123456789: [{ id: 'F_G', title: 'גוף E2E', mimeType: 'application/vnd.google-apps.folder' }], F_G: [{ id: 'P_A', title: NEW + '.pdf', mimeType: 'application/pdf' }] }

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const staff = await b.newContext({ viewport: { width: 1280, height: 900 } })
if (process.env.PDFJS_DIR) await staff.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', (r) => r.fulfill({ body: readFileSync(path.join(process.env.PDFJS_DIR, r.request().url().includes('worker') ? 'pdf.worker.min.js' : 'pdf.min.js'), 'utf8'), contentType: 'text/javascript' }))
await staff.route('**/api/crm/mcp', async (r) => {
  const { server, tool, input } = JSON.parse(r.request().postData() || '{}')
  if (server !== 'Google Drive') return r.continue()
  if (tool === 'search_files') { const m = String(input.query || '').match(/parentId = '([^']+)'/); return r.fulfill({ json: { payload: { files: m ? DRIVE[m[1]] || [] : [] } } }) }
  if (tool === 'download_file_content' && input.fileId === 'P_A') return r.fulfill({ json: { payload: { id: 'P_A', mimeType: 'application/pdf', content: bytes.toString('base64') } } })
  return r.fulfill({ status: 400, json: { message: 'unexpected ' + tool } })
})
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await staff.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await staff.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const pageErrs = []; page.on('pageerror', (e) => pageErrs.push(e.message))
let envIds = [], before = null
const ours = () => sql`select id, name, folder, category, fields, signers from sign_templates where name in ${sql(NAMES)} and deleted_at is null order by name`
const stripId = (fs) => fs.map(({ id, ...f }) => Object.fromEntries(Object.entries(f).sort()))
const FIELDS_N = stripId(FIELDS)
try {
  await sql`update sign_templates set deleted_at = now() where name in ${sql(NAMES)} and deleted_at is null`
  await sql`insert into crm_docs (coll, doc_id, data) values ('clients', ${CLIENT}, ${sql.json({ id: CLIENT, name: 'דנה כהן', idNumber: '000000018', email: 'dana@example.com', phone: '0521234567', division: 'finance', status: 'active', product: 'mortgage', log: [] })})
    on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  before = await page.evaluate(() => ({ review: S.settings.signTplReview || [], advisor: S.settings.advisor || null }))

  step('טופס שכבר בספרייה "לבדיקה" עם שדות מנוחשים (כמו ייבוא לפני שהיו שדות מוכנים)')
  const oldId = await page.evaluate(async ({ b64, name }) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), up = await pdfUpload([new File([bytes], name + '.pdf', { type: 'application/pdf' })], name)
    const t = await signApi('/api/sign/templates', { name, category: 'bank', folder: 'גוף E2E', scope: 'system', requireOtp: true, fileId: up.fileId, fields: [{ id: 'g1', page: 0, kind: 'signature', signer: 1, x: 0.6, y: 0.82, w: 0.28, h: 0.06 }] })
    await tplReviewSet([t.id]); return { id: t.id, curated: !!up.curated }
  }, { b64: bytes.toString('base64'), name: OLD })
  assert(oldId.curated, 'העלאת הקובץ: השרת מזהה אותו (טביעה) ומחזיר שדות מוכנים')
  await page.evaluate(() => { S.pdfTpls = null; S.f.formsView = 'lib'; go('forms') })
  await page.waitForFunction((id) => !(S.settings.signTplReview || []).includes(id), oldId.id, { timeout: 15000 })
  let T = await ours()
  assert(JSON.stringify(stripId(T.find((t) => t.name === OLD).fields)) === JSON.stringify(FIELDS_N) && T.find((t) => t.name === OLD).signers === 2, 'טעינת הספרייה: השדות המנוחשים הוחלפו בשדות המוכנים (2 לווים), "לבדיקה" ירד')

  step('ייבוא מדרייב של אותו קובץ בשם הגוף → שדות מוכנים, בלי "לבדיקה"')
  await page.click('[data-act="pdfDriveImport"]')
  await page.fill('#pdImpUrl', 'https://drive.google.com/drive/folders/ROOT_CUR_0123456789'); await page.click('#pdImpGo')
  await page.waitForSelector('[data-pdimpf]', { timeout: 15000 }); await page.click('#pdImpGo')
  await page.waitForFunction(() => /הספרייה עודכנה/.test(($('pdImpBody') || {}).innerText || ''), null, { timeout: 60000 })
  const done = await page.locator('#pdImpBody').innerText()
  assert(/1 טפסים נוצרו/.test(done) && /מוכן/.test(done) && !/לבדיקה/.test(done), 'הסיכום: נוצר 1, "מוכן" — לא "לבדיקה"')
  T = await ours(); const nu = T.find((t) => t.name === NEW)
  assert(nu && nu.folder === 'גוף E2E' && nu.category === 'poa' && JSON.stringify(stripId(nu.fields)) === JSON.stringify(FIELDS_N), 'התבנית: בתיקיית הגוף, ייפוי כוח, עם השדות המוכנים')
  assert(!(await page.evaluate((id) => (S.settings.signTplReview || []).includes(id), nu.id)), 'לא מסומן "לבדיקה"')
  await page.click('#pdImpGo'); await page.waitForTimeout(500)

  step('ספרייה: סינון לפי סוג · בבחירה לשליחה — "סמן את כל ה-N"')
  await page.evaluate(() => { $('layer').innerHTML = ''; S.plLib = { scope: 'system', folder: 'גוף E2E' }; S.f.formsView = 'lib'; go('forms') }); await page.waitForTimeout(500)
  const rowsTxt = await page.locator('#plLib .tplrow').allInnerTexts()
  assert(rowsTxt.length === 2 && rowsTxt.every((t) => /כתב הסמכה ליועץ/.test(t)), 'בתיקיית הגוף: שני הטפסים, הסוג מופיע בשורה')
  if (process.env.E2E_OUT) await page.screenshot({ path: path.join(process.env.E2E_OUT, 'forms-by-type@1280.png') })
  const picked = await page.evaluate(() => new Promise((ok) => { pdfPicker({ id: 'x', division: 'finance' }, ok); S.plPick.folder = 'גוף E2E'; $('plPickBody').innerHTML = pdfLibView(S.plPick, 'pick');
    const chip = [...document.querySelectorAll('#plPickBody [data-pltype]')].find((x) => x.dataset.pltype === 'poa'); if (!chip) return ok([]); chip.click()
    setTimeout(() => { document.querySelector('[data-plselall]').click(); setTimeout(() => document.getElementById('plPickGo').click(), 100) }, 100) }))
  assert(picked.length === 2, '"סמן את כל ה-2" → שני הטפסים נבחרו כמסמך אחד')

  step('פרטי היועץ בהגדרות → נכנסים לטופס; טופס לשני לווים → ללקוחה עם לווה אחד')
  await page.evaluate(() => write('settings/main', { advisor: { finance: { name: 'הר-אל פתרונות מימון בע"מ', id: '515000000' } } }, 'update')); await page.waitForTimeout(300)
  await page.evaluate(({ c, id }) => { S.signForm = S.signForm || {}; S.signForm[c] = { open: true, tpl: 'pdf:' + id }; S.f.formsView = 'send'; go('forms', c) }, { c: CLIENT, id: nu.id }); await page.waitForTimeout(1200)
  await page.click('#signcard [data-act="signSend"]'); await page.waitForTimeout(2500)
  const [e1] = await sql`select id, pdf_fields from sign_envelopes where client_doc = ${CLIENT} and deleted_at is null order by created_at desc limit 1`; envIds.push(e1?.id)
  assert(e1 && e1.pdf_fields.every((f) => f.signer === 1) && e1.pdf_fields.length === 6, 'נשלח ללווה אחד: השדות של לווה 2 ירדו (נשארים ריקים בטופס)')
  const rq = await sql`select token_hash, fields->'@prefill' pre from sign_requests where envelope_id = ${e1.id}`
  const adv = e1.pdf_fields.find((f) => f.src === 'advisor_name'), advId = e1.pdf_fields.find((f) => f.src === 'advisor_id')
  assert(rq.length === 1 && rq[0].pre.values[adv.id] === 'הר-אל פתרונות מימון בע"מ' && rq[0].pre.values[advId.id] === '515000000', 'פרטי היועץ מההגדרות ממולאים מראש')
  const link = await page.evaluate(() => S.signLast && S.signLast.links[0] && S.signLast.links[0].url)
  const signer = await staff.newPage(); await signer.goto(link.replace(/^https?:\/\/[^/]+/, BASE)); await signer.waitForTimeout(800)
  const advIn = signer.locator('input[data-fid="' + adv.id + '"]')
  assert(await advIn.inputValue() === 'הר-אל פתרונות מימון בע"מ' && (await advIn.getAttribute('readonly')) !== null, 'בעמוד החתימה: פרטי היועץ מוצגים לקריאה בלבד')
  if (process.env.E2E_OUT) await signer.screenshot({ path: path.join(process.env.E2E_OUT, 'sign-advisor@1280.png'), fullPage: true })
  // קוד אימות: וואטסאפ קודם, והחותם יכול לבחור מייל (דן, 21/10). רק כשהשרת רץ עם GREEN_API_* (E2E_WA=1 — אפשר עם GREEN_API_HOST מדומה)
  if (process.env.E2E_WA) {
    const btns = await signer.$$eval('[data-otpvia]', (xs) => xs.map((x) => x.dataset.otpvia + (x.classList.contains('primary') ? '*' : '')))
    assert(btns.join(',') === 'whatsapp*,email', 'קוד אימות: "שלחו לי בוואטסאפ" (ראשי) ו"שלחו לי במייל" (' + btns.join(',') + ')')
    await signer.click('[data-otpvia="whatsapp"]'); await signer.waitForTimeout(1200)
    const [o] = await sql`select channel, target from outbox where dedup_key like 'sign-otp:%' order by created_at desc limit 1`
    assert(o && o.channel === 'whatsapp' && o.target === '972521234567', 'הקוד יצא בוואטסאפ למספר של החותמת')
    await signer.click('[data-otpvia="email"]'); await signer.waitForTimeout(1200)
    const [o2] = await sql`select channel, target from outbox where dedup_key like 'sign-otp:%' order by created_at desc limit 1`
    assert(o2 && o2.channel === 'email' && o2.target === 'dana@example.com', 'מעבר למייל מיד (בלי לחכות דקה)')
  }
  await signer.close()
  assert(!pageErrs.length, 'אין שגיאות בדף' + (pageErrs.length ? ': ' + pageErrs.join(' | ') : ''))
  console.log('\nשדות מוכנים לטפסי הגופים — עבר.')
} finally {
  for (const id of envIds.filter(Boolean)) { await sql`update sign_envelopes set deleted_at = coalesce(deleted_at, now()) where id = ${id}`.catch(() => {}); await sql`update sign_requests set deleted_at = coalesce(deleted_at, now()) where envelope_id = ${id}`.catch(() => {}) }
  await sql`update sign_templates set deleted_at = now() where name in ${sql(NAMES)} and deleted_at is null`.catch(() => {})
  await sql`update crm_docs set deleted_at = now() where coll = 'clients' and doc_id = ${CLIENT}`.catch(() => {})
  if (before) await page.evaluate((v) => write('settings/main', { signTplReview: v.review, advisor: v.advisor }, 'update'), before).catch(() => {})
  await b.close(); await sql.end()
}
