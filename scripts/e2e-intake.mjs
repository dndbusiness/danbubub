/**
 * קצה-לקצה ל-ADDENDUM ב.3 (קליטת חשבוניות) על ה-DB המקומי, דרך ההעלאה הידנית (אותו צינור כמו Gmail/Drive):
 *   PDF סינתטי → חילוץ (כללים) → כרטיס הצעה → "נכון" → invoices + שידוך לתנועה + תבנית ספק + משימה נסגרת → העלאה חוזרת = כפילות.
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import postgres from 'postgres'

if (existsSync('.env.local')) for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2] }
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); process.exit(1) } console.log(`✓ ${m}`) }

step('הכנה: תנועת הוצאה של 1,180 ₪ ב-04/09 בלי חשבונית (לשידוך)')
await sql`select set_config('app.current_user_id', '00000000-0000-4000-8000-000000000001', false)`
const cat = (await sql`select id from categories where name = 'רו"ח' limit 1`)[0].id
const acc = (await sql`select id from accounts where type = 'bank' limit 1`)[0].id
await sql`update inbox_candidates set deleted_at = now() where source = 'manual_upload' and deleted_at is null`
await sql`update invoices set deleted_at = now() where counterparty like 'ספק לדוגמה%' and deleted_at is null`
await sql`delete from suppliers where name like 'ספק לדוגמה%'`.catch(() => sql`update suppliers set deleted_at = now(), extraction_template = null where name like 'ספק לדוגמה%'`)
await sql`update transactions set deleted_at = now() where source_ref = 'e2e:intake:1'`
await sql`insert into transactions (date_cash, account_id, amount_net, vat_mode, nature, division, category_id, deductible, counterparty, description, invoice_status, source, source_ref)
          values ('2026-09-04', ${acc}, -1180, 'incl', 'expense', 'finance', ${cat}, true, 'ספק לדוגמה', 'ייעוץ', 'missing', 'manual', 'e2e:intake:1')`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())

step('העלאת PDF מהנייד')
await page.goto(`${BASE}/import/inbox`, { waitUntil: 'load' })
await page.setInputFiles('input[name=file]', resolve('tests/fixtures/intake/invoice-sample.pdf'))
await page.getByRole('button', { name: 'קלוט' }).click()
await page.waitForSelector('[role=status]', { timeout: 30_000 })
await page.waitForTimeout(500)
const card = page.locator('li', { hasText: 'ספק לדוגמה' }).first()
assert(await card.count() > 0, 'כרטיס הצעה עם הספק מהמסמך')
const cardText = await card.innerText()
assert(/1,180/.test(cardText) && /180/.test(cardText), `סה"כ ומע"מ חולצו (${cardText.replace(/\n/g, ' · ').slice(0, 120)})`)

step('אישור אנושי — "נכון"')
await card.getByRole('button', { name: /נכון/ }).click()
await page.waitForTimeout(400)
const docNo = await page.locator('input[name=doc_number]').inputValue()
assert(docNo === '7001', `מס׳ מסמך בהצעה: ${docNo}`)
const txSel = await page.locator('select[name=tx_id]').inputValue()
assert(txSel !== '', 'הצעת שידוך לתנועה נבחרה אוטומטית')
await page.getByRole('button', { name: /נכון — אשר/ }).click()
await page.waitForSelector('text=נרשמה חשבונית', { timeout: 20_000 })
const status = await page.locator('[role=status]').innerText()
assert(status.includes('שודכה'), `שודכה לתנועה (${status})`)

step('DB: חשבונית, תנועה has_invoice, תבנית לספק, משימה נסגרה')
const [inv] = await sql`select i.doc_number, i.amount_gross, i.matched_tx_id, t.invoice_status from invoices i join transactions t on t.id = i.matched_tx_id where i.doc_number = '7001' and i.deleted_at is null`
assert(inv && Number(inv.amount_gross) === -1180 && inv.invoice_status === 'has_invoice', 'invoices(received) + transactions.invoice_status=has_invoice')
const [sup] = await sql`select extraction_template from suppliers where name like 'ספק לדוגמה%' and deleted_at is null`
assert(sup?.extraction_template?.gross, 'תבנית ספק נלמדה מהמסמך המאושר')
const [task] = await sql`select status from tasks where auto_key like 'inbox:%' order by created_at desc limit 1`
assert(task?.status === 'done', 'המשימה "חשבונית לאישור" נסגרה')

step('אותו קובץ שוב = כפילות')
await page.setInputFiles('input[name=file]', resolve('tests/fixtures/intake/invoice-sample.pdf'))
await page.getByRole('button', { name: 'קלוט' }).click()
await page.waitForSelector('text=כבר נקלט', { timeout: 20_000 })
console.log('✓ כפילות זוהתה')
await browser.close(); await sql.end()
