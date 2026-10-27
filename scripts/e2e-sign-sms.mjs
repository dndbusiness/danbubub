/**
 * בדיקת קצה-לקצה — שליחת מסמך לחתימה ב-SMS דרך SLNG (דן, 21/10):
 *   שליחה לחתימה → בחלון "נשלח לחתימה" — "שלח ב-SMS" → השרת רושם את הלקוח בטופס של SLNG (שם פרטי, נייד 05…, הקישור) →
 *   "ה-SMS נשלח" · בתור היציאה (sms, נשלח) · בתיעוד החתימה ובביומן הלקוח · קישור ישן (אחרי "קישור" חדש) — נדחה.
 * SLNG מדומה (שרת מקומי). נתונים סינתטיים בלבד. מנקה אחריו.
 *
 *   השרת רץ עם: SLNG_FORM_URL=http://127.0.0.1:4599/form SLNG_FIELD_NAME=fn SLNG_FIELD_PHONE=fp SLNG_FIELD_LINK=fl
 *   או במצב API: SLNG_API_USER=e2e SLNG_API_PASSWORD=e2e SLNG_FROM=0500000000 SLNG_API_URL=http://127.0.0.1:4599/api
 *   BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-sign-sms.mjs
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const url = process.env.DATABASE_URL || env.DATABASE_URL
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const CLIENT = 'e2e-sms-client'

// SLNG מדומה: טופס (multipart) או API (JSON, SendSmsJsonBody — דן 27/10). שני המצבים נבדקים באותן הבטחות.
const posts = []
const slng = createServer((req, res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', async () => {
  if (/json/.test(req.headers['content-type'] || '')) {
    const j = JSON.parse(Buffer.concat(ch).toString('utf8')), body = String(j.MsgBody || '')
    posts.push({ path: req.url, api: true, user: j.Username, from: j.FromMobile, fn: (body.match(/^שלום (\S+),/) || [])[1], fp: (j.Mobiles || [])[0]?.Mobile, fl: (body.match(/(https?:\/\/\S+)/) || [])[1], body })
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ Status: true, Description: 'Command received successfully', GeneralGUID: 'e2e-guid' }))
  }
  const fd = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: Buffer.concat(ch) }).formData()
  posts.push({ path: req.url, fn: fd.get('fn'), fp: fd.get('fp'), fl: fd.get('fl') }); res.writeHead(200); res.end('ok') }) })
await new Promise((ok) => slng.listen(4599, '127.0.0.1', ok))

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const staff = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await staff.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await staff.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const pageErrs = []; page.on('pageerror', (e) => pageErrs.push(e.message))
let envId = null
try {
  await sql`insert into crm_docs (coll, doc_id, data) values ('clients', ${CLIENT}, ${sql.json({ id: CLIENT, name: 'דנה כהן', idNumber: '000000018', phone: '052-123-4567', address: 'הרצל 1, חולון', division: 'finance', status: 'active', product: 'car_loan', log: [] })})
    on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.evaluate(async () => { await fetch('/api/sign/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) })
  await page.waitForFunction(() => (S.settings.signLibrary || []).some((t) => t.key === 'lib:finance-car-advisor'), null, { timeout: 15000 })

  step('שליחה לחתימה (טלפון בלבד, בלי מייל) → חלון "נשלח לחתימה" עם "שלח ב-SMS"')
  await page.evaluate((c) => { S.signForm = {}; S.f.formsView = 'send'; go('forms', c) }, CLIENT); await page.waitForTimeout(1200)
  await page.uncheck('#signOtp').catch(() => {})
  await page.click('#signcard [data-act="signSend"]'); await page.waitForTimeout(2500)
  const [e] = await sql`select id from sign_envelopes where client_doc = ${CLIENT} and deleted_at is null order by created_at desc limit 1`; envId = e && e.id
  assert(envId, 'המסמך נשלח')
  assert(await page.locator('.drawer [data-signsms="0"]').count() === 1, 'בחלון: "שלח ב-SMS"')
  if (process.env.E2E_OUT) await page.screenshot({ path: process.env.E2E_OUT + '/sign-sms@1280.png' })

  step('"שלח ב-SMS" → SLNG מקבל שם פרטי, נייד 05… והקישור')
  await page.click('.drawer [data-signsms="0"]'); await page.waitForTimeout(2500)
  const link = await page.evaluate(() => S.signLast.links[0].url)
  assert(posts.length === 1 && posts[0].fn === 'דנה' && posts[0].fp === '0521234567' && posts[0].fl === link && /\/s\/[\w-]+$/.test(link), 'SLNG קיבל' + (posts[0].api ? ' (API, שולח ' + posts[0].from + ')' : ' (טופס)') + ': דנה · 0521234567 · ' + link)
  assert(/נשלח ב-SMS/.test(await page.locator('.drawer [data-signsms="0"]').innerText()), 'הכפתור: "נשלח ב-SMS ✓"')
  const [o] = await sql`select status, target from outbox where channel = 'sms' and dedup_key like 'sign-sms:%' order by created_at desc limit 1`
  assert(o && o.status === 'sent' && o.target === '0521234567', 'בתור היציאה: sms, נשלח')
  const [rq] = await sql`select fields->'@events' ev from sign_requests where envelope_id = ${envId}`
  assert(rq.ev.some((x) => x.kind === 'shared' && /SMS ל-0521234567/.test(x.detail || '')), 'בתיעוד החתימה: "ב-SMS ל-0521234567"')
  const [cl] = await sql`select data->'log' log from crm_docs where coll = 'clients' and doc_id = ${CLIENT}`
  assert(cl.log.some((x) => /ב-SMS ל-0521234567 \(SLNG\)/.test(x.text)), 'ביומן הלקוח: נשלח ב-SMS')

  step('קישור ישן (אחרי "קישור" חדש) — לא נשלח')
  const [rid] = await sql`select id from sign_requests where envelope_id = ${envId}`
  const r2 = await page.evaluate(async ({ id, old }) => { await fetch('/api/sign/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'link' }) })
    const r = await fetch('/api/sign/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'sms', url: old }) }); return { status: r.status, j: await r.json() } }, { id: rid.id, old: link })
  assert(r2.status === 422 && /כבר לא פעיל/.test(r2.j.error) && posts.length === 1, 'נדחה: "הקישור הזה כבר לא פעיל"')
  assert(!pageErrs.length, 'אין שגיאות בדף' + (pageErrs.length ? ': ' + pageErrs.join(' | ') : ''))
  console.log('\nSMS דרך SLNG — עבר.')
} finally {
  if (envId) { await sql`update sign_envelopes set deleted_at = coalesce(deleted_at, now()) where id = ${envId}`.catch(() => {}); await sql`update sign_requests set deleted_at = coalesce(deleted_at, now()) where envelope_id = ${envId}`.catch(() => {}) }
  await sql`update crm_docs set deleted_at = now() where coll = 'clients' and doc_id = ${CLIENT}`.catch(() => {})
  slng.close(); await b.close(); await sql.end()
}
