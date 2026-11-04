/**
 * שיחות חזרה למתעניינים (דן 04/11): מתעניינים → 📞 תאם שיחה (תאריך + שעה + על מה) → משימה + יומן "למי לחזור היום" במסך הבית
 * + תקציר הבוקר → מסך מלא 10 דק׳ לפני ו-5 דק׳ לפני (שעון מדומה) → ביטול רק עם סיבה → בשעה עצמה כבר לא קופץ → הסיבה ביומן ובליד.
 * מריצים מול שרת מקומי (npm start). CHROMIUM=<נתיב> כשצריך · E2E_OUT=<תיקייה לצילומים>
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000', OUT = process.env.E2E_OUT ?? null
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const shot = async (page, n) => { if (OUT) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, n + '.png') }) } }

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage(), errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
await page.clock.install({ time: new Date() })
const LID = 'e2e-call-' + Date.now().toString(36), NAME = 'דנה Levi-כהן'
const tick = async (min) => { await page.clock.fastForward(Math.round(min * 60e3)); await page.waitForTimeout(300); await page.evaluate(() => callTick()); await page.waitForTimeout(200) }
try {
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || '')); await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  await page.waitForTimeout(2500); await page.evaluate(() => { const l = document.getElementById('layer'); if (l) l.innerHTML = ''; const c = document.getElementById('callpop'); if (c) c.remove() })

  step('מתעניין → 📞 תאם שיחה')
  await page.evaluate(async ([id, name]) => { await write('leads/' + id, { id, name, phone: '0501234567', stage: 'followup', resp: 'dan', division: 'finance', note: 'בדיקה אוטומטית', createdAt: stamp(), updatedAt: stamp() }) }, [LID, NAME])
  await page.waitForFunction((id) => S.leads.has(id), LID)
  await page.evaluate(() => { S.f.clientView = 'interest'; go('clients') })
  await page.waitForSelector(`[data-callset="${LID}"]`, { timeout: 15000 })
  await page.click(`[data-callset="${LID}"]`); await page.waitForSelector('#d_time')
  const at = await page.evaluate(() => { const d = new Date(Date.now() + 12 * 60e3); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) })
  await page.fill('#d_date', at.slice(0, 10)); await page.fill('#d_time', at.slice(11)); await page.fill('#dform textarea[name="note"]', 'לחזור אחרי שבדקה עם הבנק — Mizrahi')
  await page.click('#dsave'); await page.waitForFunction((id) => live(S.tasks).some((t) => t.kind === 'call' && t.leadId === id), LID)
  await page.waitForFunction((id) => (S.leads.get(id).log || []).some((x) => /תואמה שיחה/.test(x.text)), LID, { timeout: 10000 }).catch(() => {})
  const T = await page.evaluate((id) => { const t = live(S.tasks).find((x) => x.kind === 'call' && x.leadId === id); return { id: t.id, due: t.due, time: t.time, rule: t.ruleKey, resp: t.resp, log: (S.leads.get(id).log || []).map((x) => x.text).join(' | ') } }, LID)
  assert(T.due + 'T' + T.time === at && T.rule === 'leadcall:' + LID, `נוצרה משימת שיחה ל-${T.due} ${T.time} (rule_key ${T.rule})`)
  assert(/תואמה שיחה ל/.test(T.log), 'נרשם בהיסטוריה של המתעניין')
  await page.waitForSelector(`button.pill[data-callset="${LID}"]`)
  assert((await page.textContent(`button.pill[data-callset="${LID}"]`)).includes(T.time), 'ברשימת המתעניינים: ⏰ ' + T.time)
  await shot(page, 'calls-interest')

  step('מסך הבית: "למי לחזור היום" + תקציר הבוקר')
  await page.evaluate(() => go('day')); await page.waitForSelector('.callday')
  const card = await page.textContent('.callday')
  assert(card.includes(NAME) && card.includes(T.time) && card.includes('Mizrahi'), 'ביומן במסך הבית: השם, השעה ועל מה לדבר')
  const mail = await page.evaluate(() => morningMail(S.me.id, today()).html)
  assert(mail.includes('למי לחזור היום') && mail.includes(T.time), 'בתקציר הבוקר: טבלת שיחות לפי שעה')
  await page.evaluate(() => callDayPop(true)); await page.waitForSelector('.callpopday'); assert((await page.textContent('.callpopday')).includes(NAME), 'יומן תחילת היום (חלון) — למי לחזור ומתי')
  await shot(page, 'calls-daypop'); await page.click('#layer [data-close]')

  step('10 דקות לפני — מסך מלא')
  await tick(2.2); await page.waitForSelector('#callpop', { timeout: 5000 })
  assert((await page.textContent('#callpop')).includes('בעוד 10 דקות') && (await page.textContent('#callpop')).includes(NAME), 'קפץ מסך מלא: "בעוד 10 דקות — ' + T.time + '"')
  const full = await page.evaluate(() => { const r = document.getElementById('callpop').getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1 })
  assert(full, 'ההתראה על כל המסך'); await shot(page, 'calls-pop10')
  await page.click('#callpop .cpok'); await tick(0.5)
  assert(!(await page.$('#callpop')), '"הבנתי" — לא חוזר על אותו שלב')

  step('5 דקות לפני — שוב מסך מלא')
  await tick(5); await page.waitForSelector('#callpop', { timeout: 5000 })
  assert((await page.textContent('#callpop')).includes('בעוד 5 דקות'), 'קפץ: "בעוד 5 דקות"')

  step('ביטול — רק עם סיבה')
  await page.click('#callpop [data-callcancel]'); await page.waitForSelector('#d_reason')
  assert(!(await page.$('#callpop')), 'מסך ההתראה נסגר לחלון הביטול')
  await page.click('#dsave'); await page.waitForTimeout(200)
  assert(/לכתוב למה/.test(await page.textContent('#derr')), 'בלי סיבה — לא מבטל ("לכתוב למה השיחה מבוטלת")')
  await page.click('[data-callreason="הלקוח ביקש לדחות"]'); await page.click('#dsave')
  await page.waitForFunction((id) => !!S.tasks.get(id).deletedAt, T.id)
  await page.waitForFunction((id) => (S.leads.get(id).log || []).some((x) => /בוטלה/.test(x.text)), LID, { timeout: 10000 }).catch(() => {})
  const C = await page.evaluate(([id, lid]) => { const t = S.tasks.get(id); return { c: t.cancelled, r: t.cancelReason, log: (S.leads.get(lid).log || []).map((x) => x.text).join(' | ') } }, [T.id, LID])
  assert(C.c && C.r === 'הלקוח ביקש לדחות' && /בוטלה — הלקוח ביקש לדחות/.test(C.log), 'בוטלה: הסיבה נשמרה במשימה ובהיסטוריה של המתעניין')

  step('בשעת השיחה — לא קופץ (בוטלה)')
  await tick(5.5); await tick(1)
  assert(!(await page.$('#callpop')), 'אין התראה אחרי ביטול')
  await page.evaluate(() => render()); await page.waitForSelector('.callday')
  const card2 = await page.textContent('.callday')
  assert(card2.includes('בוטלה') && card2.includes('הלקוח ביקש לדחות'), 'ביומן: "בוטלה" + הסיבה')
  await shot(page, 'calls-cancelled')

  step('שיחה שנייה → בשעה עצמה: מסך מלא אדום → בוצעה')
  await page.evaluate((id) => callDrawer(id), LID); await page.waitForSelector('#d_time')
  const at2 = await page.evaluate(() => { const d = new Date(Date.now() + 3 * 60e3); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) })
  await page.fill('#d_date', at2.slice(0, 10)); await page.fill('#d_time', at2.slice(11)); await page.click('#dsave')
  await page.waitForFunction((id) => live(S.tasks).some((t) => t.kind === 'call' && t.leadId === id && t.status !== 'done'), LID)
  await tick(3.2); await page.waitForSelector('#callpop.now', { timeout: 5000 })
  assert((await page.textContent('#callpop')).includes('הגיעה השעה'), 'בשעה: "הגיעה השעה" (מסך מלא)'); await shot(page, 'calls-popnow')
  await page.click('#callpop [data-calldone]'); await page.waitForTimeout(400)
  const D = await page.evaluate((id) => live(S.tasks).filter((t) => t.kind === 'call' && t.leadId === id).map((t) => t.status), LID)
  assert(D.length === 1 && D[0] === 'done' && !(await page.$('#callpop')), 'בוצעה — נסגר, המשימה בוצעה')

  step('נייד 390px')
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => render()); await page.waitForSelector('.callday'); await shot(page, 'calls-390')
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(ovf <= 1, 'בלי גלילה לרוחב ב-390px (' + ovf + ')')
  assert(!errs.length, 'בלי שגיאות בדף' + (errs.length ? ': ' + errs.join(' | ') : ''))
  console.log('\nשיחות חזרה — הכל עבר')
} catch (e) { console.error(e); process.exitCode = 1 } finally {
  await page.evaluate(async (id) => { for (const t of live(S.tasks).filter((x) => x.leadId === id)) await write('tasks/' + t.id, { deletedAt: stamp(), deletedReason: 'בדיקה אוטומטית' }, 'update'); await write('leads/' + id, { deletedAt: stamp() }, 'update') }, LID).catch(() => {})
  await b.close()
}
