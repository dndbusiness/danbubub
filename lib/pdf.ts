/**
 * PDF — SPEC §8: "Playwright (HTML→PDF) — RTL אמין". SPEC §7: RTL מלא, גופן עברי,
 * כותרת עם ישות + תקופה + תאריך הפקה + "הופק ע"י".
 *
 * אותו HTML שמוצג במסך /…/print הוא זה שהופך ל-PDF (§11.20: אין שני מנועי דוחות).
 * הקבצים נשמרים ב-storage/reports (gitignored); שלב 9 מעלה אותם ל-Drive.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { GATE_COOKIE, gateToken } from '@/lib/gate'
import { storeLocalFile } from '@/lib/files'
import { isServerless, storageDir } from '@/lib/storage-dir'

export const REPORTS_DIR = process.env.HAREL_REPORTS_DIR ?? storageDir('reports')

/** נתיב ה-Chromium: CHROMIUM_PATH, או הדפדפן ש-Playwright התקין ב-PLAYWRIGHT_BROWSERS_PATH. */
export function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  try {
    const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1)
    const candidate = dir && path.join(root, dir, 'chrome-linux', 'chrome')
    return candidate && existsSync(candidate) ? candidate : undefined
  } catch { return undefined }
}

export { isServerless }

/**
 * הפעלת דפדפן. מקומית — ה-Chromium של Playwright. ב-serverless — @sparticuz/chromium-min,
 * שמוריד בינארי תואם Lambda מ-`CHROMIUM_PACK_URL` (ראו docs/DEPLOY.md §3).
 */
async function launch() {
  const { chromium } = await import('playwright')
  const local = chromiumPath()
  if (local || !isServerless()) return chromium.launch({ executablePath: local })
  const pack = process.env.CHROMIUM_PACK_URL
  if (!pack) throw new Error('הפקת PDF ב-serverless דורשת CHROMIUM_PACK_URL (ראו docs/DEPLOY.md §3) או CHROMIUM_PATH')
  const mod = (await import('@sparticuz/chromium-min')).default
  return chromium.launch({ executablePath: await mod.executablePath(pack), args: mod.args, headless: true })
}

export async function renderPdf(url: string, fileName: string): Promise<string> {
  mkdirSync(REPORTS_DIR, { recursive: true })
  const out = path.join(REPORTS_DIR, fileName)
  const browser = await launch()
  try {
    const ctx = await browser.newContext({ locale: 'he-IL' })
    // עמודי ההדפסה מאחורי שער הכניסה — הדפדפן הפנימי נכנס עם אותה עוגייה, אחרת ה-PDF הוא מסך הכניסה
    if (process.env.APP_PASSWORD) await ctx.addCookies([{ name: GATE_COOKIE, value: await gateToken(process.env.APP_PASSWORD), url: new URL(url).origin }])
    const page = await ctx.newPage()
    const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
    if (res && (res.status() >= 400 || new URL(page.url()).pathname === '/gate')) throw new Error(`עמוד ההדפסה החזיר ${res.status()} (${new URL(page.url()).pathname})`)
    await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } })
  } finally {
    await browser.close()
  }
  return out
}

/** PDF ששורד את הבקשה: נוצר, נשמר במסד (stored_files), ומוחזר גם הנתיב המקומי לשימוש מיידי. */
export async function renderPdfStored(url: string, fileName: string, kind: string): Promise<{ path: string; fileId: string }> {
  const p = await renderPdf(url, fileName)
  return { path: p, fileId: await storeLocalFile(p, fileName, 'application/pdf', kind) }
}

/**
 * כתובת הבסיס לרינדור פנימי (השרת קורא לעצמו). מקומית — localhost. ב-Vercel אין localhost:
 * הכתובת הציבורית (APP_BASE_URL, או דומיין ה-Production ש-Vercel מגדיר). לא VERCEL_URL —
 * כתובת פריסה מוגנת ב-Vercel Authentication והדפדפן הפנימי היה נחסם.
 */
export function internalBaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.HAREL_INTERNAL_URL) return env.HAREL_INTERNAL_URL.replace(/\/+$/, '')
  if (isServerless(env)) {
    if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/+$/, '')
    if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  return `http://localhost:${env.PORT ?? 3000}`
}
