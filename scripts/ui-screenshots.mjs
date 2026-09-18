/**
 * בדיקה ויזואלית — UIUX הנחיה 24: "כל מסך נבדק ב-390px, 768px, 1280px לפני PR."
 *
 *   node scripts/ui-screenshots.mjs [route ...]     ברירת מחדל: כל המסכים הבנויים
 *   BASE_URL=http://localhost:3000 OUT=docs/screenshots
 *
 * מצפה לשרת שרץ (next dev / next start). יוצר PNG לכל מסך × רוחב.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const OUT = process.env.OUT ?? 'docs/screenshots'
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/ui-kit', '/deals', '/transactions', '/fixed-expenses', '/pnl', '/nissim', '/import', '/cashflow', '/collections', '/alerts', '/anchor', '/quick', '/vat', '/gaps', '/partners', '/private', '/leads', '/forecast', '/settings']
const widths = [390, 768, 1280]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
let failures = 0

for (const route of routes) {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'he-IL' })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      // רעש שאינו של המסך: הגופן שחסמנו, ו-favicon שאין לנו.
      if (t.includes('net::ERR_FAILED') || t.includes('favicon')) return
      errors.push(t)
    })
    page.on('response', (r) => {
      if (r.status() >= 400 && !r.url().includes('favicon')) errors.push(`${r.status()} ${new URL(r.url()).pathname}`)
    })
    // גופנים חיצוניים לא נטענים בסביבת בדיקה (proxy) — חוסמים כדי שהבדיקה תהיה דטרמיניסטית.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
    const res = await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 20_000 })
    await page.waitForTimeout(300)
    // אזור מוגן: אם הוגדר PIN בסביבה, מקלידים אותו (SPEC §6)
    if (process.env.PIN) {
      const gate = page.getByRole('button', { name: /הזן קוד|פתח שוב/ })
      if (await gate.count()) {
        await gate.first().click()
        await page.getByRole('textbox', { name: 'קוד' }).fill(process.env.PIN)
        await page.getByRole('button', { name: 'אישור' }).click()
        await page.waitForTimeout(400)
      }
    }
    // שם קובץ נקי: בלי query, UUID → "id"
    const [pathname, query = ''] = route.split('?')
    const path = pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, 'id')
    const division = new URLSearchParams(query).get('division')
    const name = `${path.replace(/\//g, '_').replace(/^_/, '') || 'home'}${division ? `.${division}` : ''}@${width}.png`
    await page.screenshot({ path: `${OUT}/${name}`, fullPage: true })

    // UIUX §8: אין גלילה אופקית
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    const status = res?.status() ?? 0
    const ok = status < 400 && errors.length === 0 && !overflow
    if (!ok) failures++
    console.log(`${ok ? '✓' : '✗'} ${route} @${width}  ${status}${overflow ? '  גלילה אופקית!' : ''}${errors.length ? `  שגיאות: ${errors.join(' | ').slice(0, 200)}` : ''}`)
    await page.close()
  }
}

await browser.close()
process.exit(failures ? 1 : 0)
