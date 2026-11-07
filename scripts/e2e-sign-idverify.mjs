/**
 * אימות לפי ת״ז מהתיק (דן 07/11: "SMS לא פעיל, במייל מסובך ללקוחות — משהו שיעבוד במיידי"):
 *   שליחה לחתימה עם verifyId + ת״ז מהכרטיס → בקישור: דף שער בלבד (בלי המסמך, בלי השם ובלי הת״ז שבתיק)
 *   → ת״ז לא תקינה / שגויה — נדחה, נספר ("נשארו N ניסיונות") → ת״ז נכונה → המסמך והטופס → חתימה → עמוד התיעוד: "אימות לפי ת״ז מהתיק"
 *   → קישור שני: 5 ניסיונות שגויים = נעול. וגם: קוד שאין לו ערוץ → נופל לאימות לפי ת״ז (לא חותם בלי אימות).
 * נתונים סינתטיים בלבד (ת״ז בדיקה). מנקה אחריו. BASE_URL=http://localhost:3000 CHROMIUM=<נתיב> node scripts/e2e-sign-idverify.mjs
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000', OUT = process.env.E2E_OUT ?? null
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const sql = postgres(process.env.DATABASE_URL || env.DATABASE_URL, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const shot = async (pg, n) => { if (OUT) { mkdirSync(OUT, { recursive: true }); await pg.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true }) } }
const CLIENT = 'e2e-idverify-client', ID = '000000018', TPL = '<p>אני מאשר/ת את תנאי השירות — מסמך בדיקה אוטומטית בלבד, Test Ltd.</p>'

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const staff = await b.newContext()
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await staff.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const sp = await staff.newPage()
const api = async (method, p, data) => { const r = await sp.request.fetch(BASE + p, { method, data, headers: data ? { 'content-type': 'application/json' } : {} }); return { status: r.status(), body: await r.json().catch(() => ({})) } }
const envs = []
const send = async (signer) => { const r = await api('POST', '/api/sign', { clientDoc: CLIENT, clientName: 'דנה כהן', division: 'finance', title: 'אישור שירות (E2E)', category: 'general', template: TPL, signers: [signer] })
  if (r.body.envelopeId) envs.push(r.body.envelopeId); return r }
const client = await b.newContext({ viewport: { width: 390, height: 844 } }), cp = await client.newPage(), errs = []; cp.on('pageerror', (e) => errs.push(e.message))
try {
  await sql`insert into crm_docs (coll, doc_id, data) values ('clients', ${CLIENT}, ${sql.json({ id: CLIENT, name: 'דנה כהן', idNumber: ID, phone: '0521234567', division: 'finance', status: 'active', log: [] })})
    on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
  await sp.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))

  step('שליחה עם אימות לפי ת״ז מהתיק')
  const r1 = await send({ label: 'הלקוח', name: 'דנה כהן', phone: '0521234567', verifyId: true, prefill: { name: 'דנה כהן', idNumber: ID } })
  assert(r1.status === 200 && r1.body.links?.length === 1, 'נשלח: קישור אחד')
  const link = r1.body.links[0].url.replace(/^https?:\/\/[^/]+/, BASE)

  step('בקישור — דף שער בלבד')
  await cp.goto(link); await cp.waitForSelector('#idIn')
  const html = await cp.content()
  assert(!html.includes(ID) && !html.includes('Test Ltd') && !html.includes('דנה כהן') && !(await cp.$('#f')), 'בלי המסמך, בלי השם, בלי הת״ז שבתיק ובלי טופס החתימה')
  await shot(cp, 'idgate')
  await cp.fill('#idIn', '123'); await cp.click('#idGo'); await cp.waitForFunction(() => document.getElementById('idErr').textContent.length > 0)
  assert(/9 ספרות/.test(await cp.textContent('#idErr')), 'קצר מדי — "9 ספרות"')
  await cp.fill('#idIn', '000000026'); await cp.click('#idGo'); await cp.waitForFunction(() => /נשארו/.test(document.getElementById('idErr').textContent))
  assert(/נשארו 4 ניסיונות/.test(await cp.textContent('#idErr')), 'ת״ז תקינה אבל אחרת מהתיק — נדחה: "נשארו 4 ניסיונות"')
  const sub0 = await cp.evaluate(async (u) => (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'submit', name: 'דנה כהן', idNumber: '000000018', signature: 'data:image/png;base64,iVBORw0KGgo=', agree: true }) })).json(), '/api/s/' + link.split('/s/')[1])
  assert(!sub0.ok && /אימות ת״ז/.test(JSON.stringify(sub0)), 'חתימה ישירה בלי אימות — השרת דוחה')

  step('ת״ז נכונה → המסמך והטופס')
  await cp.fill('#idIn', '18'); await cp.click('#idGo'); await cp.waitForSelector('#f', { timeout: 10000 })
  assert((await cp.textContent('body')).includes('Test Ltd') && await cp.inputValue('#idn') === ID, 'אחרי האימות: המסמך מוצג, הת״ז ממולאת')
  await shot(cp, 'idgate-ok')
  await cp.locator('#cv').scrollIntoViewIfNeeded(); const pad = await cp.locator('#cv').boundingBox(); await cp.mouse.move(pad.x + 30, pad.y + pad.height / 2); await cp.mouse.down()
  for (let k = 0; k <= 30; k++) await cp.mouse.move(pad.x + 30 + k * 8, pad.y + pad.height / 2 - Math.sin(k / 3) * 20); await cp.mouse.up()
  await cp.check('#agree'); await cp.click('#go'); await cp.waitForFunction(() => /נחתם|תודה/.test(document.body.innerText), null, { timeout: 15000 })
  const [row] = await sql`select status, fields->'@events' ev, fields->>'@idOk' ok from sign_requests where envelope_id = ${envs[0]}`
  assert(row.status === 'signed' && row.ok && row.ev.some((e) => e.kind === 'otp_verified' && /ת״ז/.test(e.detail || '')) && row.ev.some((e) => e.kind === 'otp_failed'), 'נחתם; בתיעוד: ניסיון שגוי + "אימות לפי ת״ז — תואמת לתיק"')
  const audit = await api('GET', '/api/sign?client=' + CLIENT)
  assert(audit.status === 200, 'רשימת המסמכים של הלקוח')

  step('קישור שני: 5 ניסיונות שגויים — נעול')
  const r2 = await send({ label: 'הלקוח', name: 'דנה כהן', phone: '0521234567', verifyId: true, prefill: { name: 'דנה כהן', idNumber: ID } })
  const t2 = r2.body.links[0].url.split('/s/')[1]
  let last = null
  for (let i = 0; i < 6; i++) last = await cp.evaluate(async (t) => (await fetch('/api/s/' + t, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'id_verify', idNumber: '000000026' }) })).json(), t2)
  const ok2 = await cp.evaluate(async (t) => (await fetch('/api/s/' + t, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'id_verify', idNumber: '000000018' }) })).json(), t2)
  assert(!last.ok && /יותר מדי/.test(last.error) && !ok2.ok, 'אחרי 5 שגויים — נעול, גם הת״ז הנכונה לא פותחת ("לפנות אלינו לקישור חדש")')

  step('קוד אימות בלי ערוץ (אין מייל, וואטסאפ לא מוגדר) → נופל לאימות לפי ת״ז')
  const r3 = await send({ label: 'הלקוח', name: 'דנה כהן', phone: '0521234567', requireOtp: true, prefill: { name: 'דנה כהן', idNumber: ID } })
  const [row3] = await sql`select require_otp, fields->'@verifyId' v from sign_requests where envelope_id = ${envs[2]}`
  assert(row3.require_otp === false && row3.v === true && r3.body.warnings.some((w) => /יאומת לפי ת״ז/.test(w)), 'לא חותם בלי אימות: מאומת לפי ת״ז, עם הסבר')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nאימות לפי ת״ז — עבר.')
} catch (e) { console.error(e); process.exitCode = 1 } finally {
  for (const id of envs) { await sql`update sign_requests set deleted_at = now() where envelope_id = ${id}`.catch(() => {}); await sql`update sign_envelopes set deleted_at = now() where id = ${id}`.catch(() => {}) }
  await sql`update crm_docs set deleted_at = now() where coll = 'clients' and doc_id = ${CLIENT}`.catch(() => {})
  await sql.end(); await b.close()
}
