/**
 * וואטסאפ — Cloud API (דן 22/11: "אני רוצה שהוואטסאפ יעבוד"). Meta מדומה על 127.0.0.1:4598.
 * השרת עם: WA_CLOUD_TOKEN=e2e WA_PHONE_NUMBER_ID=P1 WA_WABA_ID=W1 WA_APP_SECRET=e2e-secret WA_VERIFY_TOKEN=e2e-verify WA_GRAPH_BASE=http://127.0.0.1:4598
 * אימות webhook → הודעה לא חתומה נדחית → הודעה ממספר לא מוכר = ליד חדש + שיחה → בכרטיס הליד ובתיבה → נקרא → תשובה (טקסט) →
 * סטטוס "נקרא" → אחרי 24 שעות: רק תבנית (עם משתנה) → תמונה נכנסת עם קישור → שליחה כפולה של webhook = 0 חדשות. נמחק בסוף. CHROMIUM=<נתיב>
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import http from 'node:http'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const sql = postgres(process.env.DATABASE_URL || env.DATABASE_URL, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const SECRET = env.WA_APP_SECRET || 'e2e-secret', VERIFY = env.WA_VERIFY_TOKEN || 'e2e-verify'

/* Meta מדומה */
const got = []
const mock = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
  got.push({ m: req.method, u: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null }); res.setHeader('content-type', 'application/json')
  if (/\/P1\/messages$/.test(req.url)) return res.end(JSON.stringify({ messages: [{ id: 'wamid.E2E' + got.length }] }))
  if (/\/W1\/message_templates/.test(req.url)) return res.end(JSON.stringify({ data: [{ name: 'docs_followup', language: 'he', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'שלום {{1}}, נשמח להמשיך בבקשה שלך. מתי נוח לדבר?' }] }, { name: 'draft_one', language: 'he', status: 'PENDING', components: [] }] }))
  if (/\/W1\/subscribed_apps$/.test(req.url)) return res.end(JSON.stringify({ success: true }))
  res.statusCode = 404; res.end('{}') }) })
await new Promise((ok) => mock.listen(4598, '127.0.0.1', ok))

const hook = (body, sign = true) => { const raw = JSON.stringify(body); return fetch(BASE + '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(sign ? { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex') } : {}) }, body: raw }) }
const PH = '972549998877', LOCAL = '0549998877', ts = () => String(Math.floor(Date.now() / 1000))
const msg = (id, extra) => ({ object: 'whatsapp_business_account', entry: [{ id: 'W1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P1' }, contacts: [{ wa_id: PH, profile: { name: 'יוסי בדיקה' } }], messages: [{ id, from: PH, timestamp: ts(), type: 'text', text: { body: 'היי, ראיתי מודעה על הלוואה כנגד רכב' }, ...extra }] } }] }] })

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
let leadId = null
try {
  step('webhook: אימות ההרשמה, חתימה')
  const v = await fetch(BASE + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=' + VERIFY + '&hub.challenge=12345')
  assert(v.status === 200 && (await v.text()) === '12345', 'אימות ההרשמה של Meta מחזיר את ה-challenge')
  assert((await fetch(BASE + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')).status === 403, 'טוקן אימות שגוי — נדחה')
  assert((await hook(msg('wamid.IN1'), false)).status === 401, 'הודעה בלי חתימה — נדחית')

  step('הודעה ממספר לא מוכר → ליד חדש + שיחה')
  const r1 = await (await hook(msg('wamid.IN1'))).json()
  assert(r1.ok && r1.messages === 1 && r1.createdLeads === 1, 'נקלטה, נפתח ליד')
  const r1b = await (await hook(msg('wamid.IN1'))).json()
  assert(r1b.messages === 0, 'אותו webhook שוב — 0 הודעות חדשות')
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.waitForFunction((ph) => S.waChats.has(ph) && S.leads.has(S.waChats.get(ph).leadId), LOCAL, { timeout: 15000 })
  leadId = await page.evaluate((ph) => S.waChats.get(ph).leadId, LOCAL)
  const lead = await page.evaluate((id) => S.leads.get(id), leadId)
  assert(lead.name === 'יוסי בדיקה' && lead.source === 'whatsapp' && lead.phone === LOCAL, 'הליד: "יוסי בדיקה", מקור וואטסאפ')

  step('בכרטיס הליד ובתיבה')
  await page.evaluate((id) => go('lead', id), leadId); await page.waitForSelector('#waCard .wab.in')
  assert(/ראיתי מודעה על הלוואה כנגד רכב/.test(await page.locator('#waCard').textContent()), 'ההודעה בכרטיס הליד')
  await page.waitForFunction((ph) => !S.waChats.get(ph).unread, LOCAL, { timeout: 8000 })
  assert(true, 'פתיחת השיחה — סומנה כנקראה')
  await page.evaluate(() => { S.f.leadView = 'wa'; go('leads') }); await page.waitForSelector('.wachat')
  assert(/יוסי בדיקה/.test(await page.locator('.walist').textContent()), 'בתיבת הוואטסאפ: השיחה ברשימה')
  await page.locator('.wachat', { hasText: 'יוסי בדיקה' }).click(); await page.waitForSelector('#waTxt')

  step('תשובה — טקסט חופשי בתוך 24 שעות')
  await page.fill('#waTxt', 'היי יוסי, כאן דן מהר-אל. מה שנת הרכב?'); await page.click('[data-wasend]')
  await page.waitForFunction((ph) => live(S.waMsgs).some((m) => m.phone === ph && m.dir === 'out' && m.status === 'sent'), LOCAL, { timeout: 15000 })
  const sent = got.find((g) => /\/P1\/messages$/.test(g.u))
  assert(sent && sent.auth === 'Bearer e2e' && sent.body.to === PH && sent.body.text.body === 'היי יוסי, כאן דן מהר-אל. מה שנת הרכב?', 'נשלח ל-Meta: למספר ' + PH + ' עם הטוקן של השרת')
  const ob = await sql`select status from outbox where channel = 'whatsapp' and target = ${LOCAL} order by created_at desc limit 1`
  assert(ob[0] && ob[0].status === 'sent', 'עבר דרך תיבת היוצא (sent)')
  const wamid = await page.evaluate((ph) => live(S.waMsgs).find((m) => m.phone === ph && m.dir === 'out').wamid, LOCAL)
  await hook({ object: 'whatsapp_business_account', entry: [{ id: 'W1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P1' }, statuses: [{ id: wamid, status: 'delivered', timestamp: ts(), recipient_id: PH }, { id: wamid, status: 'read', timestamp: ts(), recipient_id: PH }] } }] }] })
  await page.waitForFunction((ph) => live(S.waMsgs).some((m) => m.phone === ph && m.dir === 'out' && m.status === 'read'), LOCAL, { timeout: 15000 })
  assert(true, 'סטטוס מ-Meta: ✓✓ נקרא')

  step('אחרי 24 שעות — רק תבנית')
  await page.evaluate((ph) => write('waChats/' + ph, { lastInAt: new Date(Date.now() - 30 * 3600e3).toISOString() }, 'update'), LOCAL)
  await page.waitForSelector('[data-watpl]', { timeout: 15000 })
  const opts = await page.locator('[data-watpl] option').allTextContents()
  assert(opts.some((o) => /docs_followup/.test(o)) && !opts.some((o) => /draft_one/.test(o)), 'רק תבניות מאושרות ברשימה')
  await page.selectOption('[data-watpl]', 'docs_followup|he'); await page.waitForSelector('[data-wavar="0"]')
  assert((await page.inputValue('[data-wavar="0"]')) === 'יוסי', 'המשתנה הראשון — השם הפרטי מוכן')
  await page.click('[data-wasendtpl]')
  await page.waitForFunction((ph) => live(S.waMsgs).some((m) => m.phone === ph && m.type === 'template' && m.status === 'sent'), LOCAL, { timeout: 15000 })
  const tp = got.filter((g) => /\/P1\/messages$/.test(g.u)).at(-1).body
  assert(tp.type === 'template' && tp.template.name === 'docs_followup' && tp.template.components[0].parameters[0].text === 'יוסי', 'תבנית נשלחה עם המשתנה')
  assert(await page.evaluate((ph) => live(S.waMsgs).some((m) => m.phone === ph && m.text === 'שלום יוסי, נשמח להמשיך בבקשה שלך. מתי נוח לדבר?'), LOCAL), 'בשיחה: הטקסט כמו שהלקוח רואה')
  const bad = await (await fetch(BASE + '/api/crm/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', cookie: (await ctx.cookies()).map((c) => c.name + '=' + c.value).join('; ') }, body: JSON.stringify({ phone: LOCAL, text: 'סתם' }) })).json()
  assert(!bad.ok && /24 שעות/.test(bad.error), 'טקסט חופשי אחרי 24 שעות — נחסם בשרת עם הסבר')

  step('תמונה נכנסת')
  await hook(msg('wamid.IN2', { type: 'image', text: undefined, image: { id: '777000111', mime_type: 'image/jpeg', caption: 'רישיון רכב' } }))
  await page.waitForFunction((ph) => live(S.waMsgs).some((m) => m.phone === ph && m.type === 'image'), LOCAL, { timeout: 15000 })
  const href = await page.locator('.wab.in a[href*="/api/crm/whatsapp/media"]').first().getAttribute('href')
  assert(href === '/api/crm/whatsapp/media?id=777000111', 'קישור לתמונה דרך השרת')

  step('רישום ה-CRM לחשבון')
  await page.click('[data-act="waSubscribe"]'); await page.waitForTimeout(800)
  assert(got.some((g) => g.m === 'POST' && /\/W1\/subscribed_apps$/.test(g.u)), 'POST /{waba}/subscribed_apps')
  assert(!errs.length, 'אין שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהכל עבר ✓')
} finally {
  await sql`update crm_docs set deleted_at = now() where (coll = 'waMsgs' and data->>'phone' = ${LOCAL}) or (coll = 'waChats' and doc_id = ${LOCAL}) or (coll = 'leads' and doc_id like ${'wa-' + LOCAL + '%'})`.catch(() => {})
  await sql`update outbox set deleted_at = now() where channel = 'whatsapp' and target = ${LOCAL}`.catch(() => {})
  await sql.end(); await b.close(); mock.close()
}
