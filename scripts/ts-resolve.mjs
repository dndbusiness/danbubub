/**
 * מאפשר ל-node לטעון מודולים מ-lib/ בזמן `--experimental-strip-types`:
 *
 *  • סיומת `.js` בייבוא יחסי (הכתיב שנדרש ל-TypeScript/ESM) → הקובץ `.ts` בפועל.
 *  • הכינוי `@/` (מוגדר ב-tsconfig ומשמש בכל הקוד) → שורש הפרויקט. בלעדיו כל
 *    מודול ב-lib/ שמייבא `@/lib/db` נטען רק דרך Next, ולא מסקריפט.
 *
 * נרשם עם `register()` לפני import דינמי. ראו scripts/import-workbook.mjs.
 */
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(import.meta.dirname)

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const path = join(ROOT, specifier.slice(2))
    const url = pathToFileURL(path).href
    for (const candidate of [url.replace(/\.js$/, '.ts'), url, `${url}.ts`]) {
      try { return await next(candidate, context) } catch { /* הבא בתור */ }
    }
  }
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try { return await next(specifier.slice(0, -3) + '.ts', context) } catch { /* ליפול חזרה */ }
  }
  return next(specifier, context)
}
