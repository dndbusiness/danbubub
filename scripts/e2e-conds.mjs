/**
 * בדיקת קצה-לקצה — התניות האישור העקרוני → משימות, בחירה (דן, 22/10):
 *   "להדס גם לסמן כמה ספציפיים ולהכניס רק אותם למשימה — את היתר מתי שנכון בציר, כדי שלא יתמלא היומן":
 *   תיק בשלב "השלמות לאישור עקרוני" עם 4 התניות → מסמנים 2 "למשימה" → "המסומנות → משימות" ליום שנבחר →
 *   2 משימות בלבד (להדס, עם התאריך) · השתיים האחרות עדיין פתוחות לבחירה · "כל הפתוחות" — רק מה שנשאר ·
 *   ✓ במשימה מסמן את ההתניה. נתונים סינתטיים בלבד. מנקה אחריו.
 *
 *   BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-conds.mjs
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const url = process.env.DATABASE_URL || env.DATABASE_URL
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const CID = 'e2e-conds-client'
const CONDS = ['תלושי שכר 3 אחרונים', 'אישור ביטוח מבנה', 'נסח טאבו עדכני', 'הסכם מכר חתום']

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const pageErrs = []; page.on('pageerror', (e) => pageErrs.push(e.message))
const tasks = () => sql`select data from crm_docs where coll = 'tasks' and data->>'condOf' = ${CID} and deleted_at is null`
try {
  await sql`insert into crm_docs (coll, doc_id, data) values ('clients', ${CID}, ${sql.json({ id: CID, name: 'לקוח התניות', phone: '0521234567', division: 'finance', status: 'open', product: 'new_mortgage',
    proc: { step: 'conds', principle: { fund: 'בנק בדיקה', managerName: 'רונית', managerPhone: '0509999999' }, conds: CONDS.map((text) => ({ text })) }, log: [] })})
    on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.evaluate((c) => { S.f.procView = null; go('client', c) }, CID); await page.waitForTimeout(1200)

  step('4 התניות פתוחות — לכל אחת "למשימה"; "המסומנות" כבוי עד שמסמנים')
  assert(await page.locator('[data-condpick]').count() === 4, '4 תיבות "למשימה"')
  assert(await page.locator('[data-act="condsSelToTasks"]').isDisabled(), '"המסומנות → משימות" כבוי בלי סימון')
  assert(/כל הפתוחות → משימות \(4\)/.test(await page.locator('[data-act="condsToTasks"]').innerText()), 'הכפתור הקיים נשאר: "כל הפתוחות → משימות (4)"')

  step('מסמנים 2 (תלושים, נסח) → "המסומנות → משימות" ליום שנבחר')
  await page.check(`[data-condpick="${CID}|0"]`); await page.waitForTimeout(200); await page.check(`[data-condpick="${CID}|2"]`); await page.waitForTimeout(200)
  assert(/המסומנות → משימות \(2\)/.test(await page.locator('[data-act="condsSelToTasks"]').innerText()), '"המסומנות → משימות (2)"')
  if (process.env.E2E_OUT) await page.screenshot({ path: process.env.E2E_OUT + '/conds-pick@1280.png' })
  await page.fill('#condDue', '2026-11-05')
  await page.click('[data-act="condsSelToTasks"]'); await page.waitForTimeout(1500)
  let T = (await tasks()).map((r) => r.data)
  assert(T.length === 2 && T.every((t) => t.resp === 'hadas' && t.due === '2026-11-05'), '2 משימות בלבד, להדס, ל-5/11')
  assert(T.some((t) => t.title.includes('תלושי שכר')) && T.some((t) => t.title.includes('נסח טאבו')) && T.every((t) => /רונית/.test(t.notes || '')), 'המשימות: התלושים והנסח, עם מנהל התיק בגוף')
  assert(await page.locator('[data-condpick]').count() === 2, 'שתי ההתניות האחרות עדיין פתוחות לבחירה')

  step('"כל הפתוחות" — רק מה שנשאר (בלי כפילויות)')
  await page.click('[data-act="condsToTasks"]'); await page.waitForTimeout(1500)
  T = (await tasks()).map((r) => r.data)
  assert(T.length === 4 && new Set(T.map((t) => t.title)).size === 4, '4 משימות סה״כ, אחת לכל התניה')
  assert(await page.locator('[data-condpick]').count() === 0, 'אין עוד מה לסמן')

  step('✓ במשימה → ההתניה מסומנת בתיק')
  const t0 = T.find((t) => t.title.includes('ביטוח'))
  await page.check(`[data-taskdone="${t0.id}"]`); await page.waitForTimeout(1500)
  const [c] = await sql`select data->'proc'->'conds' conds from crm_docs where coll = 'clients' and doc_id = ${CID}`
  assert(c.conds.find((x) => x.text === 'אישור ביטוח מבנה').done === true, 'ההתניה "אישור ביטוח מבנה" סומנה ✓')
  for (const [w, h] of [[390, 844], [768, 1024]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300)
    assert(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, 'בלי גלילה לרוחב ב-' + w) }
  assert(!pageErrs.length, 'אין שגיאות בדף' + (pageErrs.length ? ': ' + pageErrs.join(' | ') : ''))
  console.log('\nהתניות → משימות לפי בחירה — עבר.')
} finally {
  await sql`update crm_docs set deleted_at = now() where coll = 'tasks' and data->>'condOf' = ${CID} and deleted_at is null`.catch(() => {})
  await sql`update crm_docs set deleted_at = now() where coll = 'clients' and doc_id = ${CID}`.catch(() => {})
  await b.close(); await sql.end()
}
