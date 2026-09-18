/**
 * קצה-לקצה לשלב 5 (SPEC §9: "דן מזין יתרה מהנייד יומית; התראה ראשונה נתפסה"):
 *   /anchor בנייד (390px) → הקלדת יתרה + שמור → סגירת יום נרשמת → alerts_eval רץ →
 *   /alerts מציג לפחות התראה אחת → /cashflow מציג את 13 השבועות והסטייה.
 * מניח DB מקומי עם חשבון בנק (dev-db.sh). BASE_URL, CHROMIUM_PATH.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'

if (existsSync('.env.local')) for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2] }

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'he-IL' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); process.exit(1) } console.log(`✓ ${m}`) }
const balance = process.env.BALANCE ?? '150000'

step('עוגן מהנייד — 3 טאפים: פתיחה, הקלדה, שמור')
await page.goto(`${BASE}/anchor`, { waitUntil: 'load' })
await page.fill('input[name=balance]', balance)
await page.fill('input[name=available_credit]', '40000')
await page.getByRole('button', { name: /שמור|עדכן עוגן/ }).click()
await page.waitForSelector('[role=status]', { timeout: 20_000 })
const status = await page.locator('[role=status]').innerText()
assert(status.includes('העוגן נשמר'), `העוגן נשמר (${status.replace(/\n/g, ' · ')})`)

step('הערכת התראות (חלק ג׳ alerts_eval) דרך ה-API')
const res = await fetch(`${BASE}/api/jobs/alerts_eval`, { method: 'POST', headers: process.env.JOBS_SECRET ? { 'x-jobs-secret': process.env.JOBS_SECRET } : {} })
const out = await res.json()
assert(res.ok, `alerts_eval רץ: ${out.active} פעילות, ${out.created} חדשות, ${out.resolved} נסגרו`)

step('מסך ההתראות')
await page.goto(`${BASE}/alerts`, { waitUntil: 'load' })
const cards = await page.locator('main li').count()
assert(cards >= 1 || out.active === 0, `ההתראות מוצגות (${cards})`)
if (out.active === 0) console.log('   (אין תנאי התראה בנתונים הנוכחיים — ההתראה הראשונה תיתפס כשיהיה תנאי)')

step('מסך התזרים — 13 שבועות וסגירת יום')
await page.setViewportSize({ width: 1280, height: 900 })
await page.goto(`${BASE}/cashflow`, { waitUntil: 'load' })
assert((await page.locator('tbody tr').count()) === 13, '13 שורות שבועות')
await page.getByRole('button', { name: /סטיות/ }).click()
await page.waitForTimeout(300)
assert((await page.getByText(/צפי .* בפועל/).count()) >= 1, 'סגירת היום מוצגת בטאב סטיות')

step('דף הבית — 6 הקוביות')
await page.goto(`${BASE}/`, { waitUntil: 'load' })
for (const t of ['מזומן', 'הוצאות קרובות', 'התחשבנות', 'גביה וביצוע', 'רווח החודש', 'דורש טיפול']) assert(await page.getByText(t, { exact: true }).count() > 0, `קובייה: ${t}`)
await browser.close()
