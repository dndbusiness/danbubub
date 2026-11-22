/**
 * וויאסנטר — סיכום, תמלול וקישור ישיר לשיחה (דן 22/11). CDR סינתטי עם AIData (Insights.Summary + Transcript) לליד סינתטי
 * → הסיכום ביומן הליד (פעם אחת, גם כשה-CDR נשלח שוב) → "📝 תמלול" בכרטיס → מגירה עם סיכום, תמלול, הקלטה וקישור → #call:<id> פותח ישר
 * → הסיכום נכנס ל"הכר את הלקוח". השרת עם VOICENTER_WEBHOOK_SECRET ב-.env.local. הכל נמחק בסוף. CHROMIUM=<נתיב>
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const L = 'e2evcai-lead', PH = '0549990001', IVR = 'e2evcai-' + Date.now()
const cdr = (extra) => ({ ivruniqueid: IVR, type: 'Outgoing', direction: 'out', callerextension: '101', target: PH, status: 'ANSWER', isAnswer: 1, time: Math.floor(Date.now() / 1000) + 7200, duration: 200, actualCallDuration: 190, record: 'https://example.com/rec/' + IVR + '.mp3', var_leadId: L, ...extra })
const post = (body) => fetch(BASE + '/api/voicenter/cdr?key=' + encodeURIComponent(env.VOICENTER_WEBHOOK_SECRET || ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.evaluate(([L, PH]) => write('leads/' + L, { id: L, name: 'מתעניין שיחה Test', phone: PH, stage: 'contacted', division: 'finance', source: 'manual', createdAt: stamp(), updatedAt: stamp(), log: [] }), [L, PH])
  await page.waitForFunction((L) => S.leads.has(L), L)

  step('CDR ראשון בלי AI, ואחריו אותו CDR עם סיכום ותמלול')
  assert((await post(cdr({}))).Err === 0, 'CDR נקלט')
  const ai = { AIData: { Insights: { Summary: 'הלקוח מבקש הלוואה של 80 אלף כנגד רכב 2020, נשוי, שכיר.' }, Transcript: [{ Speaker: 'Agent', Text: 'שלום, מדבר דן מהר-אל' }, { Speaker: 'Customer', Text: 'היי, אני צריך 80 אלף' }] } }
  assert((await post(cdr(ai))).Err === 0, 'CDR עם AIData נקלט')
  assert((await post(cdr(ai))).Err === 0, 'שליחה חוזרת — נקלט בלי כפילות')
  await page.waitForFunction(([L, IVR]) => S.calls.has(IVR) && S.calls.get(IVR).aiSummary && (S.leads.get(L).log || []).some((x) => x.ref === 'vc-ai-' + IVR), [L, IVR], { timeout: 20000 })
  const n = await page.evaluate(([L, IVR]) => S.leads.get(L).log.filter((x) => x.ref === 'vc-ai-' + IVR).length, [L, IVR])
  assert(n === 1, 'הסיכום ביומן הליד — פעם אחת')

  step('בכרטיס הליד: "📝 תמלול" → מגירה עם הכל')
  await page.evaluate((L) => go('lead', L), L); await page.waitForTimeout(400)
  assert(await page.locator('text=🤖 סיכום: הלקוח מבקש הלוואה').count() >= 1, 'הסיכום מתחת לשיחה')
  await page.locator('[data-vcinfo="' + IVR + '"]').click(); await page.waitForSelector('.drawer')
  const dt = await page.locator('.drawer').textContent()
  assert(/נציג:\s*שלום, מדבר דן/.test(dt) && /לקוח:\s*היי, אני צריך 80 אלף/.test(dt), 'תמלול: נציג / לקוח')
  assert(await page.locator('.drawer audio').count() === 1, 'נגן הקלטה במגירה')
  await page.locator('[data-vccopy="' + IVR + '"]').click(); await page.waitForTimeout(300)
  const link = await page.evaluate(() => navigator.clipboard.readText())
  assert(link.endsWith('#call:' + encodeURIComponent(IVR)), 'קישור ישיר: ' + link.replace(/^https?:\/\/[^/]+/, ''))

  step('הקישור הישיר פותח את השיחה')
  const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push(e.message))
  await p2.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '') + '#call:' + encodeURIComponent(IVR))
  await p2.waitForSelector('.drawer', { timeout: 60000 })
  assert(/תמלול/.test(await p2.locator('.drawer').textContent()) && (await p2.evaluate(() => S.view.tab)) === 'lead', 'נפתח כרטיס הליד + מגירת השיחה')
  await p2.close()

  step('הסיכום נכנס ל"הכר את הלקוח"')
  await page.evaluate((L) => { $('layer').innerHTML = ''; go('intake', L) }, L)
  await page.waitForFunction((L) => /📞 סיכום שיחה: הלקוח מבקש הלוואה/.test((S.intakes.get(L) || {}).freeText || ''), L, { timeout: 8000 })
  assert(true, 'במלל החופשי: "📞 סיכום שיחה: …"')
  assert(!errs.length, 'אין שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nהכל עבר ✓')
} finally {
  await page.evaluate(async ([L, IVR]) => { for (const p of ['leads/' + L, 'calls/' + IVR, 'intakes/' + L]) await write(p, { deletedAt: stamp() }, 'update').catch(() => {}) }, [L, IVR]).catch(() => {})
  await b.close()
}
