/**
 * "הכר את הלקוח" ← "Claude — מלא את השדות" (דן 19/11: "למה לא עובד"). Claude מדומה בדפדפן:
 * תשובה שבורה (JSON חלקי) → ניסיון שני אוטומטי עם יותר מקום → הצעות לשדות · תקרה יומית → הסיבה האמיתית במסך.
 * נתונים סינתטיים; מנקה אחריו. CHROMIUM=<נתיב>
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const CID = 'e2e-ik-' + Date.now().toString(36)
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(() => {
  sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' }))
  /* Claude מדומה: window.__ikMode = 'broken-then-ok' | 'budget' */
  const fake = Object.assign(async () => ({ text: '' }), { limits: async () => ({ images: { maxCount: 5 } }), json: async (input, opts) => {
    window.__ikCalls = [...(window.__ikCalls || []), opts.modelTier]
    if (window.__ikMode === 'budget') throw Object.assign(new Error('הגעתם לתקרה היומית (50 ₪)'), { code: 'resource_exhausted' })
    if (window.__ikCalls.length === 1) throw Object.assign(new Error('Claude לא החזיר JSON תקין'), { code: 'invalid_json' })
    return { fields: [{ path: 'request.amount', value: '100K', why: 'סגירת הלוואה בסך 30K והלוואה נוספת 70K' }, { path: 'property.value', value: '900 אלף', why: 'כנס בדימונה שווי כנס 900 אלף' }], ask: ['מה ההכנסה של בן הזוג?'] } } })
  const keep = { use: (n) => n === 'sample' ? Promise.resolve(fake) : (window.__realClaude ? window.__realClaude.use(n) : Promise.resolve(null)) }
  Object.defineProperty(window, 'claude', { configurable: true, get: () => keep, set: (v) => { window.__realClaude = v } })
})
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.waitForTimeout(1500); await page.evaluate(() => { const l = document.getElementById('layer'); if (l) l.innerHTML = ''; document.getElementById('callpop')?.remove() })
  await page.evaluate(async (id) => { await write('clients/' + id, { id, name: 'לקוח בדיקה E2E', division: 'finance', status: 'open', product: 'mortgage', createdAt: stamp(), updatedAt: stamp() }) }, CID)
  await page.waitForFunction((id) => S.clients.has(id), CID)
  await page.evaluate((id) => go('intake', id), CID); await page.waitForSelector('#ikFree')
  await page.fill('#ikFree', 'כנס בדימונה שווי כנס 900 אלף. מטרת ההלוואה: סגירת הלוואה בסך 30K והלוואה נוספת 70K שעבורם יש החזר כבד.')

  step('תשובה שבורה בניסיון הראשון → ניסיון שני אוטומטי → הצעות לשדות')
  await page.evaluate(() => { window.__ikMode = 'broken-then-ok'; window.__ikCalls = [] })
  await page.click('[data-act="ikExtract"]'); await page.waitForFunction(() => S.ikSug && !S.ikSug.busy, null, { timeout: 20000 })
  const r1 = await page.evaluate(() => ({ calls: window.__ikCalls, rows: S.ikSug.rows.map((r) => [r.path, r.val]), err: S.ikSug.err || '' }))
  assert(JSON.stringify(r1.calls) === '["default","complex"]', 'ניסיון ראשון נכשל (JSON שבור) → ניסיון שני עם יותר מקום')
  const got = Object.fromEntries(r1.rows); assert(!r1.err && r1.rows.length === 2 && got['request.amount'] === 100000 && got['property.value'] === 900000, 'הוצעו: סכום 100,000 · שווי נכס 900,000')

  step('תקרה יומית → הסיבה האמיתית במסך (לא "נסה שוב" כללי)')
  await page.evaluate(() => { window.__ikMode = 'budget'; window.__ikCalls = []; S.ikSug = null; render() })
  await page.click('[data-act="ikExtract"]'); await page.waitForFunction(() => S.ikSug && S.ikSug.err, null, { timeout: 20000 })
  const e2 = await page.evaluate(() => S.ikSug.err)
  assert(/תקרת השימוש היומית/.test(e2) && /50 ₪/.test(e2) && /AI_DAILY_ILS/.test(e2), 'מוצג: ' + e2)
  assert(await page.evaluate(() => window.__ikCalls.length) === 1, 'על תקרה — בלי ניסיון שני מיותר')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nמילוי שדות מהשיחה — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 } finally {
  await page.evaluate(async (id) => { await write('clients/' + id, { deletedAt: stamp() }, 'update'); if (S.intakes.has(id)) await write('intakes/' + id, { deletedAt: stamp() }, 'update') }, CID).catch(() => {})
  await b.close()
}
