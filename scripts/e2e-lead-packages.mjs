/**
 * חשבון לידים — אבינועם (דן 20/11): מחיר 160 מתחילת החודש (חודשים קודמים — הישן) · חבילה: 50% בתחילה, 50% בסוף ·
 * לזיכוי = לידים חלופיים, לא כסף. שיווק ← חשבון לידים → "מחיר לליד" → "+ חבילה" → לידים טובים / לזיכוי → מקדמה → "+ תשלום" → סוף החבילה → יתרה.
 * נתונים סינתטיים (טבלת לידים "E2E", ספק "E2E ספק"); הכל חוזר למצב הקודם בסוף. CHROMIUM=<נתיב>
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const SUP = 'E2E ספק', SHEET = 'E2E טבלת לידים', M = new Date().toISOString().slice(0, 7), prevM = (() => { const d = new Date(M + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) })()
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept())
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
let saved = null; const IDS = []
const bill = (m) => page.evaluate(([m, sup]) => { const x = leadBill(m, 'finance').sup.find((s) => s.name === sup); return x && JSON.parse(JSON.stringify({ charge: x.charge, cost: x.cost, due: x.due, billable: x.billable, credit: x.credit, pk: x.pkgs.map((p) => ({ good: p.st.good.length, credit: p.st.credit.length, rem: p.st.remaining, done: p.st.done, ...p.M })) })) }, [m, SUP])
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.waitForTimeout(1500); await page.evaluate(() => { const l = document.getElementById('layer'); if (l) l.innerHTML = ''; document.getElementById('callpop')?.remove() })
  saved = await page.evaluate(() => JSON.parse(JSON.stringify({ sheets: S.settings.leadSheets || null, terms: S.settings.leadTerms || null, pk: S.settings.leadPackages || null })))
  /* טבלה של ספק בדיקה: 150 לליד. לידים: 2 בחודש הקודם, 5 החודש (אחד לזיכוי) */
  await page.evaluate(async ({ SUP, SHEET, M, prevM, ids }) => {
    await write('settings/main', { leadSheets: [...(S.settings.leadSheets || []), { key: 'e2epk', fileId: 'e2epk0000000000', label: SHEET, marketer: SUP, costPerLead: 150 }] }, 'update')
    const mk = async (id, day, extra = {}) => { ids.push(id); await write('leads/' + id, { id, name: 'ליד בדיקה ' + id, source: 'sheet', srcKey: 'e2epk', sheet: SHEET, marketer: SUP, division: 'finance', stage: 'new', createdAt: day + 'T10:00:00.000Z', updatedAt: stamp(), ...extra }) }
    await mk('e2epk-p1', prevM + '-10'); await mk('e2epk-p2', prevM + '-20')
    await mk('e2epk-1', M + '-02'); await mk('e2epk-2', M + '-03', { stage: 'credit', creditState: 'approved' }); await mk('e2epk-3', M + '-04'); await mk('e2epk-4', M + '-05'); await mk('e2epk-5', M + '-06')
  }, { SUP, SHEET, M, prevM, ids: IDS })
  await page.waitForFunction(() => S.leads.has('e2epk-5') && (S.settings.leadSheets || []).some((s) => s.key === 'e2epk'))
  for (const id of ['e2epk-p1', 'e2epk-p2', 'e2epk-1', 'e2epk-2', 'e2epk-3', 'e2epk-4', 'e2epk-5']) IDS.includes(id) || IDS.push(id)
  const b0 = await bill(M)
  assert(b0 && b0.billable === 4 && b0.charge === 600 && b0.credit === 1, 'לפני השינוי: 4 לחיוב × 150 = 600 (לזיכוי לא מחויב — זיכוי בכסף)')

  step('מחיר לליד: 160 מהחודש — החודש הקודם נשאר ב-150')
  await page.evaluate(() => { S.f.mkt = 'bill'; go('marketing') }); await page.waitForSelector(`[data-leadprice="${SUP}"]`)
  await page.click(`[data-leadprice="${SUP}"]`); await page.fill('#d_from', M); await page.fill('#d_price', '160'); await page.click('#dsave')
  await page.waitForFunction((sup) => ((S.settings.leadTerms || {})[sup] || []).length === 1, SUP)
  const b1 = await bill(M), bp = await bill(prevM)
  assert(b1.charge === 640 && bp.charge === 300, `החודש 4 × 160 = ${b1.charge} · החודש הקודם 2 × 150 = ${bp.charge}`)

  step('+ חבילה: 4 לידים × 160 מתחילת החודש → לזיכוי לא נספר (ליד חלופי), מקדמה 50%')
  await page.click(`[data-pkgnew="${SUP}"]`); await page.waitForSelector('#d_leads'); await page.fill('#d_start', M + '-01'); await page.fill('#d_leads', '4')
  assert(await page.inputValue('#d_price') === '160', 'מחיר החבילה מוצע לפי המחיר החדש (160)')
  await page.click('#dsave'); await page.waitForFunction((sup) => (S.settings.leadPackages || []).some((x) => x.supplier === sup && !x.deletedAt), SUP); await page.waitForTimeout(300)
  const b2 = await bill(M)
  assert(b2.charge === 0 && b2.pk.length === 1 && b2.pk[0].good === 4 && b2.pk[0].credit === 1 && b2.pk[0].done, 'החבילה: 4 טובים מתוך 4 (הליד לזיכוי לא נספר — הוחלף), לא מחויב לפי ליד')
  assert(b2.pk[0].amount === 640 && b2.pk[0].adv === 320 && b2.pk[0].dueNow === 640, 'סכום 640 · מקדמה 320 · החבילה הסתיימה → לתשלום 640 (מקדמה + יתרה)')
  assert(b2.cost === 640, 'עלות החודש בדוחות = 4 טובים × 160 = 640 (הליד לזיכוי לא עולה כסף)')
  const txt = await page.textContent(`[data-pkg]`)
  assert(/מוחלפים בלידים חלופיים, לא בכסף/.test(txt) && /מקדמה 50%/.test(txt) && /יתרה 50%/.test(txt), 'בכרטיס: לזיכוי = חלופיים · מקדמה 50% · יתרה 50%')

  step('"+ תשלום" על החבילה: מקדמה 320 → נשאר 320 (היתרה)')
  const pkId = await page.evaluate((sup) => S.settings.leadPackages.find((x) => x.supplier === sup && !x.deletedAt).id, SUP)
  await page.click(`[data-pkgpay="${pkId}"]`); await page.waitForSelector('#d_amount')
  assert(await page.inputValue('#d_amount') === '320', 'מוצע: 320 (המקדמה)')
  await page.click('#dsave'); await page.waitForFunction((id) => live(S.leadBills).some((p) => p.pkgId === id), pkId); await page.waitForTimeout(300)
  const b3 = await bill(M)
  assert(b3.pk[0].advLeft === 0 && b3.pk[0].finLeft === 320 && b3.pk[0].dueNow === 320, 'אחרי המקדמה: היתרה 320 לתשלום (החבילה הסתיימה)')

  if (process.env.E2E_OUT) { await page.evaluate(() => document.querySelector('[data-pkg]').closest('section').scrollIntoView()); await page.screenshot({ path: process.env.E2E_OUT + '/lead-pkg.png' }) }
  step('נייד 390px')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => render()); await page.waitForTimeout(400)
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(ovf <= 1, 'בלי גלילה לרוחב ב-390px (' + ovf + ')')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nחבילות לידים — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 } finally {
  if (saved) await page.evaluate(async ({ s, ids }) => {
    for (const p of live(S.leadBills).filter((x) => x.supplier === 'E2E ספק')) await write('leadBills/' + p.id, { deletedAt: stamp() }, 'update')
    for (const id of ids) if (S.leads.has(id)) await write('leads/' + id, { deletedAt: stamp() }, 'update')
    await write('settings/main', { leadSheets: s.sheets || [], leadTerms: s.terms || {}, leadPackages: s.pk || [] }, 'update')
  }, { s: saved, ids: IDS }).catch((e) => console.error('ניקוי:', e.message))
  await b.close()
}
