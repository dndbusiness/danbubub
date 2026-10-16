/**
 * PDF — SPEC §8: "Playwright (HTML→PDF) — RTL אמין". SPEC §7: RTL מלא, גופן עברי,
 * כותרת עם ישות + תקופה + תאריך הפקה + "הופק ע"י".
 *
 * אותו HTML שמוצג במסך /…/print הוא זה שהופך ל-PDF (§11.20: אין שני מנועי דוחות).
 * הקבצים נשמרים ב-storage/reports (gitignored); שלב 9 מעלה אותם ל-Drive.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const REPORTS_DIR = process.env.HAREL_REPORTS_DIR ?? path.join(process.cwd(), 'storage', 'reports')

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

/** האם אנחנו ב-serverless (Vercel / Lambda) — שם אין דפדפן מותקן. */
export function isServerless(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.AWS_EXECUTION_ENV)
}

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
    const page = await browser.newPage({ locale: 'he-IL' })
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
    await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } })
  } finally {
    await browser.close()
  }
  return out
}

/** כתובת הבסיס לרינדור פנימי (השרת קורא לעצמו). */
export function internalBaseUrl(): string {
  return process.env.HAREL_INTERNAL_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
}
