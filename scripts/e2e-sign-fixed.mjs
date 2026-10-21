/**
 * בדיקת קצה-לקצה — ההסכם הקבוע + שטר חוב (דן, 21/10: "הסכמי השירות שלי — עם חותמת החברה, השדות מתמלאים מכרטיס הלקוח
 * למעט הערות לטופס וחתימת הלקוח; שכ״ט + שטר חוב לשליחה לחתימה"):
 *   ספריית ההסכמים נטענת (הנוסחים של דן — מאושרים) · חותמת החברה · לקוח "נכסים" עם קליטה (2%, מקדמה, ימים, סכום שטר) →
 *   "שלח לחתימה": ההסכם הקבוע נבחר לבד, כל השדות ממולאים, "צרף שטר חוב" מסומן עם הסכום → שליחה →
 *   במסמך: פרטי הלקוח ובן/בת הזוג, 2%, השטר עם הסכום במילים, מקום לחותמת · עסק: מקדמה וימים מהקליטה · ★ שליחה מהירה עם שטר.
 * נתונים סינתטיים בלבד. מנקה אחריו (החותמת והספרייה חוזרות למה שהיו).
 *
 *   BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-sign-fixed.mjs
 */
import { chromium } from 'playwright'
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
const C1 = 'e2e-fixed-prop', C2 = 'e2e-fixed-biz'

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const staff = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await staff.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await staff.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const pageErrs = []; page.on('pageerror', (e) => pageErrs.push(e.message))
let envIds = [], before = null
const client = (id, o) => sql`insert into crm_docs (coll, doc_id, data) values ('clients', ${id}, ${sql.json({ id, division: 'finance', status: 'active', log: [], ...o })})
  on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
const intake = (id, o) => sql`insert into crm_docs (coll, doc_id, data) values ('intakes', ${id}, ${sql.json({ id, clientId: id, ...o })})
  on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
const lastEnv = async (cid) => { const [e] = await sql`select id, title from sign_envelopes where client_doc = ${cid} and deleted_at is null order by created_at desc limit 1`; if (e) envIds.push(e.id); return e }
try {
  await client(C1, { name: 'דנה כהן', idNumber: '000000018', email: 'dana@example.com', phone: '0521234567', address: 'הרצל 1, חולון', spouseName: 'אבי כהן', spouseId: '000000026', spouseEmail: 'avi@example.com', spousePhone: '0527654321', product: 'nonbank_mortgage' })
  await intake(C1, { kind: 'mortgage', request: { amount: 1000000 }, fee: { type: 'pct', pct: 2, noteAmount: 30000 } })
  await client(C2, { name: 'עסק בדיקה בע"מ', idNumber: '000000034', email: 'biz@example.com', phone: '0529998877', address: 'הנגר 3, חולון', product: 'state_guarantee' })
  await intake(C2, { kind: 'business', request: { amount: 500000 }, fee: { type: 'pct', pct: 3, advance: 2500, payDays: 7 } })
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  before = await page.evaluate(() => ({ stamp: S.settings.companyStamp || null, lib: S.settings.signLibrary || null }))

  step('ספריית ההסכמים + חותמת החברה')
  const lr = await page.evaluate(async () => { const r = await fetch('/api/sign/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return r.status })
  assert(lr === 200, 'הספרייה נטענה')
  await page.waitForFunction(() => ['lib:finance-property-pledge-loan', 'lib:finance-business-plan', 'lib:finance-promissory-note'].every((k) => (S.settings.signLibrary || []).some((t) => t.key === k && !isSignDraft(t.body))), null, { timeout: 15000 })
  assert(true, 'ההסכמים של דן (נכסים, עסקים, שטר חוב) — מאושרים, לא טיוטה')
  const st = await page.evaluate(async () => { const cv = document.createElement('canvas'); cv.width = 160; cv.height = 160; const g = cv.getContext('2d'); g.strokeStyle = '#1d4ed8'; g.lineWidth = 6; g.beginPath(); g.arc(80, 80, 70, 0, 7); g.stroke(); g.font = '20px sans-serif'; g.fillStyle = '#1d4ed8'; g.fillText('E2E', 58, 88)
    return (await fetch('/api/sign/stamp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ png: cv.toDataURL('image/png') }) })).status })
  assert(st === 200, 'חותמת סינתטית הועלתה')
  await page.waitForTimeout(500)

  step('לקוח "נכסים": ההסכם הקבוע, השדות מהכרטיס, שטר חוב מסומן עם הסכום')
  await page.evaluate((c) => { S.signForm = {}; S.f.formsView = 'send'; go('forms', c) }, C1); await page.waitForTimeout(1200)
  const sel = await page.locator('#signTpl').inputValue()
  assert(sel === 'lib:finance-property-pledge-loan', 'נבחר לבד: הלוואה כנגד שעבוד נכס (' + sel + ')')
  const fee = await page.locator('[data-signf="fee_percent"]').inputValue()
  assert(fee === '2', 'שכ״ט 2% — מהקליטה')
  assert(await page.locator('[data-signnote$="|on"]').isChecked() && (await page.locator('[data-signnote$="|amount"]').inputValue()) === '30000', '"צרף שטר חוב" מסומן, 30,000 ₪ מהקליטה')
  assert(/שלושים אלף/.test(await page.locator('[data-signnotewords]').innerText()), 'הסכום במילים')
  const empty = await page.$$eval('[data-signf]', (xs) => xs.filter((x) => x.required && !x.value).map((x) => x.dataset.signf))
  assert(!empty.length, 'אין שדה חובה ריק' + (empty.length ? ': ' + empty.join(', ') : ''))
  if (process.env.E2E_OUT) await page.screenshot({ path: path.join(process.env.E2E_OUT, 'sign-fixed@1280.png'), fullPage: true })
  await page.fill('#signNotes', 'הערה לבדיקה'); await page.click('#signcard [data-act="signSend"]'); await page.waitForTimeout(2500)
  const e1 = await lastEnv(C1)
  assert(e1 && /שטר חוב/.test(e1.title), 'נשלח: "' + (e1 && e1.title) + '"')
  const rq = await sql`select signer_label, body_html, fields->>'@stamp' stamp, fields->>'@notes' notes from sign_requests where envelope_id = ${e1.id} order by signer_order`
  const txt = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
  const h = txt(rq[0].body_html)
  assert(rq.length === 2 && rq.every((r) => r.stamp), 'שני חותמים (הלקוחה ובן הזוג), וחותמת החברה בכל אחד')
  assert(h.includes('דנה כהן') && h.includes('000000018') && h.includes('אבי כהן') && h.includes('הרצל 1, חולון') && /סך של 2 ?%/.test(h), 'בהסכם: שם, ת״ז, בן הזוג, כתובת, 2%')
  assert(/שלושים אלף/.test(h) && h.includes('30,000'), 'שטר החוב: 30,000 ובמילים')
  assert(rq[0].notes === 'הערה לבדיקה', 'הערות לטופס — מה שנכתב בשליחה')

  step('לקוח "עסקים": תוכנית עסקית — מקדמה וימים לתשלום מהקליטה · ★ שליחה מהירה עם שטר')
  await page.evaluate((c) => { $('layer').innerHTML = ''; S.signForm = {}; go('forms', c) }, C2); await page.waitForTimeout(1200)
  assert(await page.locator('#signTpl').inputValue() === 'lib:finance-business-plan', 'נבחר לבד: תוכנית עסקית')
  const adv = await page.locator('[data-signf="advance"]').inputValue(), days = await page.locator('[data-signf="pay_days"]').inputValue()
  assert(adv === '2,500' && days === '7' && await page.locator('[data-signf="fee_percent"]').inputValue() === '3', 'מקדמה 2,500 · 7 ימים · 3% — מהקליטה')
  const amt2 = await page.locator('[data-signnote$="|amount"]').inputValue()
  assert(amt2 === String(Math.round(15000 * 1.18)), 'בלי סכום שטר בקליטה — שכ״ט + מע״מ (' + amt2 + ')')
  await page.evaluate(async () => { const cur = S.settings.signQuick || []; if (!cur.includes('lib:finance-business-plan')) await write('settings/main', { signQuick: [...cur, 'lib:finance-business-plan'] }, 'update') })
  await page.waitForTimeout(300); await page.evaluate((c) => { $('layer').innerHTML = ''; go('forms', c) }, C2); await page.waitForTimeout(800)
  await page.click('#signcard [data-signquick="lib:finance-business-plan"]'); await page.waitForTimeout(500)
  assert(await page.locator('.drawer input[name="noteOn"]').isChecked(), 'שליחה מהירה: "צרף שטר חוב" מסומן')
  await page.click('#dsave'); await page.waitForTimeout(2500)
  const e2 = await lastEnv(C2)
  const [r2] = await sql`select body_html from sign_requests where envelope_id = ${e2.id}`
  assert(/שטר חוב/.test(e2.title) && txt(r2.body_html).includes('2,500') && /תוך 7 ימ/.test(txt(r2.body_html)), 'נשלח עם השטר; בהסכם: מקדמה 2,500 ו-7 ימים')
  assert(!pageErrs.length, 'אין שגיאות בדף' + (pageErrs.length ? ': ' + pageErrs.join(' | ') : ''))
  console.log('\nההסכם הקבוע + שטר חוב — עבר.')
} finally {
  for (const id of envIds) { await sql`update sign_envelopes set deleted_at = coalesce(deleted_at, now()) where id = ${id}`.catch(() => {}); await sql`update sign_requests set deleted_at = coalesce(deleted_at, now()) where envelope_id = ${id}`.catch(() => {}) }
  for (const c of [C1, C2]) for (const coll of ['clients', 'intakes']) await sql`update crm_docs set deleted_at = now() where coll = ${coll} and doc_id = ${c}`.catch(() => {})
  if (before) await page.evaluate((v) => write('settings/main', { companyStamp: v.stamp, signQuick: (S.settings.signQuick || []).filter((k) => k !== 'lib:finance-business-plan') }, 'update'), before).catch(() => {})
  await b.close(); await sql.end()
}
