/**
 * חלוקת הר-אל פתרונות מ-12/2026 (דן 22/11): ניסים 33% (בלי רטרו — 11/2026 נשאר 50%), דן ויונס שליש כל אחד, אביב לא בחלוקה.
 * רווח בנובמבר ובדצמבר → חלקו של ניסים בכל חודש · החלק מפתרונות בהתחשבנות שותפי הנדל״ן · מצב חשבון "50% → 33.3%".
 * נתונים סינתטיים (הפרשים מול המצב הקיים); הכל חוזר בסוף. CHROMIUM=<נתיב>
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const close = (a, b) => Math.abs(a - b) < 0.02
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
let saved = null; const TX = ['e2efs-11', 'e2efs-12', 'e2efs-loan']
const snap = () => page.evaluate(() => { const C = nissimCard(), g = (m) => C.find((r) => r.month === m) || { share: 0, distributable: 0 }, F = finShare(), f = (m) => F.find((x) => x.month === m) || { each: 0, who: null }
  return JSON.parse(JSON.stringify({ n11: g('2026-11').share, n12: g('2026-12').share, d11: g('2026-11').distributable, d12: g('2026-12').distributable, f11: f('2026-11').each, f12: f('2026-12').each, who12: f('2026-12').who })) })
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  saved = await page.evaluate(() => JSON.parse(JSON.stringify({ re: S.settings.partnersRE || null, pct: S.settings.nissimPct ?? null, ls: S.settings.lossSharing ?? null, fs: S.settings.finSplit ?? null })))
  await page.evaluate(() => write('settings/main', { partnersRE: ['יונס', 'אביב', 'דן'], nissimPct: 0.5, lossSharing: 'shared', finSplit: null }, 'update'))
  await page.waitForFunction(() => (S.settings.partnersRE || []).length === 3)
  const s0 = await snap()
  await page.evaluate(async (ids) => {
    const t = (id, x) => write('transactions/' + id, { id, division: 'finance', nature: 'income', clientId: 'e2e-fs-client', deductible: true, review: 'ok', source: 'e2e', counterparty: 'לקוח בדיקה', createdAt: stamp(), updatedAt: stamp(), ...x })
    await t(ids[0], { date: '2026-11-10', net: 30000, gross: 35400 }); await t(ids[1], { date: '2026-12-10', net: 30000, gross: 35400 })
  }, TX)
  await page.waitForFunction(() => S.transactions.has('e2efs-12')); await page.waitForTimeout(400)
  const s1 = await snap()

  step('נובמבר: ניסים 50% (בלי רטרו) · דצמבר: 33.3%')
  assert(close(s1.d11 - s0.d11, 30000) && close(s1.d12 - s0.d12, 30000), 'רווח לחלוקה +30,000 בכל חודש')
  assert(close(s1.n11 - s0.n11, 15000), `נובמבר: ניסים +${(s1.n11 - s0.n11).toFixed(2)} (= 50%)`)
  assert(close(s1.n12 - s0.n12, 10000), `דצמבר: ניסים +${(s1.n12 - s0.n12).toFixed(2)} (= שליש)`)

  step('החלק של הר-אל: נובמבר 50% ÷ 3 (כמו קודם) · דצמבר שליש לדן וליונס, אביב לא בחלוקה')
  assert(close(s1.f11 - s0.f11, 5000), `נובמבר: לכל שותף +${(s1.f11 - s0.f11).toFixed(2)} (50% ÷ 3)`)
  assert(close(s1.f12 - s0.f12, 10000) && JSON.stringify(s1.who12) === JSON.stringify(['יונס', 'דן']), `דצמבר: +${(s1.f12 - s0.f12).toFixed(2)} לכל אחד מ-${s1.who12}`)
  const rs = await page.evaluate(() => { const D = reSettle('2026-12'); return { P: D.P.map((x) => [x.p, x.fin]), label: D.finLabel, html: reSettleHtml(D, false) } })
  const fin = Object.fromEntries(rs.P)
  assert(fin['אביב'] === 0 && fin['יונס'] > 0 && fin['דן'] === fin['יונס'], 'בהתחשבנות שותפי הנדל״ן לדצמבר: אביב 0 מפתרונות, דן ויונס שווים')
  assert(/66\.7% מהרווח לחלוקה ÷ 2 — יונס, דן/.test(rs.html), 'בדוח: "' + rs.label + '"')

  step('מצב חשבון נובמבר–דצמבר: "50% → 33.3%"; ושותפי הר-אל בדצמבר — דן ויונס')
  const st = await page.evaluate(() => { const D = stmtData('2026-12') || {}; const html = D.months ? stmtHtml(D, false) : ''; return { pct: D.pct, group: D.group, html } })
  assert(st.pct === '33.3' && JSON.stringify(st.group) === JSON.stringify(['יונס', 'דן']) && /חלקו של ניסים \(33\.3%\)/.test(st.html) && /חלקה של הר-אל \(66\.7%\) — יונס, דן/.test(st.html), 'מצב חשבון דצמבר: ניסים 33.3%, הר-אל 66.7% — יונס, דן')
  step('הלוואה קודמת (קטגוריה "הלוואה") 3,000 בדצמבר → לא יורדת מחלקו של ניסים; רק מדן ויונס')
  const sb = await snap()
  await page.evaluate(() => write('transactions/e2efs-loan', { id: 'e2efs-loan', division: 'finance', nature: 'expense', category: 'הלוואה', date: '2026-12-15', net: -3000, gross: -3000, deductible: true, review: 'ok', source: 'e2e', counterparty: 'בנק בדיקה', createdAt: stamp(), updatedAt: stamp() }))
  await page.waitForFunction(() => S.transactions.has('e2efs-loan')); await page.waitForTimeout(400)
  const sl = await snap()
  assert(close(sl.n12, sb.n12), `ניסים בדצמבר לא השתנה (${sl.n12.toFixed(2)})`)
  assert(close(sb.f12 - sl.f12, 1500), `דן ויונס: כל אחד −${(sb.f12 - sl.f12).toFixed(2)} (חצי מההלוואה)`)
  const st2 = await page.evaluate(() => stmtHtml(stmtData('2026-12'), false))
  assert(/לא יורדות מחלקו של ניסים/.test(st2) && /על יונס ודן בלבד/.test(st2), 'במצב החשבון: "ועוד: הלוואות… לא יורדות מחלקו של ניסים" ו"פחות: … על יונס ודן בלבד"')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nחלוקת הר-אל פתרונות מ-12/2026 — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 } finally {
  if (saved) await page.evaluate(async ({ s, ids }) => { for (const id of ids) if (S.transactions.has(id)) await write('transactions/' + id, { deletedAt: stamp() }, 'update')
    await write('settings/main', { partnersRE: s.re, nissimPct: s.pct ?? 0.5, lossSharing: s.ls ?? 'shared', finSplit: s.fs }, 'update') }, { s: saved, ids: TX }).catch((e) => console.error('ניקוי:', e.message))
  await b.close()
}
