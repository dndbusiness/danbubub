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

export async function renderPdf(url: string, fileName: string): Promise<string> {
  const { chromium } = await import('playwright')
  mkdirSync(REPORTS_DIR, { recursive: true })
  const out = path.join(REPORTS_DIR, fileName)
  const browser = await chromium.launch({ executablePath: chromiumPath() })
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
