/** Next מריץ את register() פעם אחת בהפעלת השרת, לפני שהוא טוען את הנתיבים. ראו lib/intake/dom-matrix.ts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') (await import('./lib/intake/dom-matrix')).ensureDOMMatrix()
}
