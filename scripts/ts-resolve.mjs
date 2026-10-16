/**
 * מאפשר ל-node לטעון מודולים מ-lib/ שמייבאים זה את זה עם סיומת `.js`
 * (הכתיב שנדרש ל-TypeScript/ESM) בזמן ש-`--experimental-strip-types` קורא `.ts`.
 * נרשם עם `register()` לפני import דינמי. ראו scripts/import-workbook.mjs.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try { return await next(specifier.slice(0, -3) + '.ts', context) } catch { /* ליפול חזרה */ }
  }
  return next(specifier, context)
}
