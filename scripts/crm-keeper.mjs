/**
 * "השומר" של ה-CRM על השרת: פותח את הדף בדפדפן בלי אדם, כדי שמה שהדף עושה לבד כשמישהו בפנים
 * ירוץ גם כשאף אחד לא בפנים — סנכרון טבלאות הלידים, סימון כפולים, אירועי יומן שממתינים, וגיבוי יומי לדרייב.
 * אותו קוד בדיוק כמו בדף (הנחיה 20 — מנוע אחד), בלי העתק בשרת.
 *
 *   APP_BASE_URL=https://… APP_PASSWORD=… JOBS_SECRET=… node scripts/crm-keeper.mjs
 *
 * רץ מ-GitHub Actions כל חצי שעה (.github/workflows/crm-keeper.yml). מדלג כשהמערכת עדיין במצב שכפול:
 * אז הדף ב-Claude הוא המקור, וגיבוי מכאן היה נכנס לאותה תיקייה ונקלט חזרה כשכפול.
 * יוצא עם קוד 1 כשמשהו נכשל — כדי שהריצה תיצבע אדום ב-Actions ותשלח התראה.
 */
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'

const log = (s) => console.log(new Date().toISOString().slice(11, 19), s)
const fresh = (at) => !!at && Date.now() - Date.parse(at) < 30 * 60e3

/** ריצה אחת. מחזיר true כשהכל הצליח (או דילוג במצב שכפול). setup — לבדיקות: מקבל את ה-context לפני הטעינה. */
export async function keep({ base, key = '', secret = '', waitMs = 4 * 60e3, executablePath, setup } = {}) {
  const BASE = String(base || '').replace(/\/+$/, '')
  if (!BASE) throw new Error('חסר APP_BASE_URL')
  const browser = await chromium.launch(executablePath ? { executablePath } : {})
  let failed = false
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
    await ctx.addInitScript(() => { window.__CRM_KEEPER = true })
    // כניסה אישית בשרת (lib/crm/auth.ts): השומר נכנס כבעלים עם JOBS_SECRET — רק בבקשות ל-API של המערכת, לא לשום כתובת אחרת
    // או אסימון OIDC של GitHub Actions (בלי סוד) — מתחדש כל 2 דקות, כי הוא קצר-מועד
    const oidc = githubOidcSource()
    if (secret || oidc) await ctx.route(BASE + '/api/**', async (r) => r.continue({ headers: { ...r.request().headers(), ...(secret ? { 'x-crm-keeper': secret } : {}), ...(oidc ? { 'x-gh-oidc': await oidc() } : {}) } }))
    if (setup) await setup(ctx)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    // ?key= פותח את שער הכניסה ושומר עוגייה (middleware.ts); הסיסמה לא נכתבת ללוג
    const res = await page.goto(`${BASE}/api/crm/mode${key ? `?key=${encodeURIComponent(key)}` : ''}`, { waitUntil: 'load', timeout: 60e3 })
    const mode = await res?.json().catch(() => null)
    // סיסמה שגויה או חסרה: השער מפנה ל-/gate, שעונה 200 עם דף כניסה ולא עם JSON
    if (!mode && /\/gate\b/.test(page.url())) throw new Error('נעצרתי בשער הכניסה — APP_PASSWORD ב-GitHub Secrets חסר או לא זהה לזה שב-Vercel')
    if (!mode) throw new Error(`לא הצלחתי לקרוא את מצב המערכת (${res?.status()}) — בדקו APP_BASE_URL / APP_PASSWORD`)
    if (mode.mode !== 'live') { log(`מדלג: המערכת במצב "${mode.mode}" — הדף ב-Claude עדיין המקור`); return true }

    await page.goto(`${BASE}/crm`, { waitUntil: 'load', timeout: 90e3 })
    await page.waitForFunction(() => window.HAREL_JOBS && window.HAREL_JOBS.ready(), null, { timeout: 120e3 })
    const started = Date.now()
    let st = await page.evaluate(() => window.HAREL_JOBS.status())
    if (!st.mcp) throw new Error('גוגל לא מחובר בשרת — אין סנכרון ואין גיבוי. הגדרות → "חבר את גוגל" (כולל CRM)')
    if (!st.owner || !st.canWrite) throw new Error('הדף לא נפתח כבעלים עם הרשאת כתיבה')
    log(`מחובר · ${st.sources.length} טבלאות לידים`)

    // הדף מתחיל לבד: סנכרון אחרי 2.5 שניות, גיבוי אחרי 4. מחכים שכל טבלה סונכרנה בחצי השעה האחרונה ושהגיבוי של היום קיים.
    while (Date.now() - started < waitMs) {
      await page.waitForTimeout(5000)
      st = await page.evaluate(() => window.HAREL_JOBS.status())
      if (st.sources.every((s) => fresh(s.at)) && st.drive && st.drive.day === st.today) break
    }
    for (const s of st.sources) {
      if (fresh(s.at)) log(`✓ ${s.label || s.key}: ${s.added ?? 0} חדשים`)
      else { failed = true; log(`✗ ${s.label || s.key}: לא סונכרן${s.error ? ' — ' + s.error : ''}`) }
    }
    if (st.drive && st.drive.day === st.today) log(`✓ גיבוי לדרייב: ${st.drive.day}${st.drive.status !== 'ok' ? ' (' + st.drive.status + ')' : ''}`)
    else { failed = true; log(`✗ גיבוי לדרייב: ${st.drive ? 'אחרון ' + st.drive.day + (st.drive.error ? ' — ' + st.drive.error : '') : 'אין'}`) }
    // נותנים לכתיבות האחרונות (סימון כפולים, אירועי יומן) להישלח לפני סגירה
    await page.waitForTimeout(8000)
    if (errors.length) log(`שגיאות בדף: ${errors.slice(0, 3).join(' | ')}`)
  } catch (e) {
    failed = true
    console.error('✗ ' + (e && e.message ? e.message : e))
  } finally {
    await browser.close()
  }
  return !failed
}

/** אסימון זהות מ-GitHub Actions (רק כשה-workflow קיבל id-token: write). מחוץ ל-Actions — אין. */
function githubOidcSource() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !tok) return null
  let cur = null, at = 0
  return async () => {
    if (cur && Date.now() - at < 120e3) return cur
    const r = await fetch(url + '&audience=harel-jobs', { headers: { authorization: 'bearer ' + tok } })
    cur = (await r.json().catch(() => ({}))).value || ''; at = Date.now(); return cur
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const env = (k) => (process.env[k] ?? '').trim() || undefined /* רווח / שורה בסוף ההדבקה ב-GitHub Secrets */
  const ok = await keep({ base: env('APP_BASE_URL')?.replace(/\/+$/, ''), key: env('APP_PASSWORD'), secret: env('JOBS_SECRET'), waitMs: Number(process.env.KEEPER_WAIT_MS || 4 * 60e3), executablePath: process.env.CHROMIUM_PATH })
    .catch((e) => { console.error('✗ ' + e.message); return false })
  process.exit(ok ? 0 : 1)
}
