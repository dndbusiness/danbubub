/**
 * DOMMatrix ריק לשרת. pdfjs-dist (בתוך pdf-parse) צריך DOMMatrix כבר בטעינה, ומשלים אותו מ-@napi-rs/canvas (חבילה נייטיב אופציונלית).
 * ב-Vercel החבילה לא נכללת בפונקציה, והטעינה קרסה ב-"DOMMatrix is not defined" — וכל /api/jobs/* נפל איתה (18/10).
 * בשרת רק מחלצים טקסט מ-PDF ולא מציירים, ולכן מטריצה ריקה מספיקה.
 * נרשם בהפעלת השרת (instrumentation.ts), כי Next טוען מראש את כל הנתיבים לפני הבקשה הראשונה.
 */
export class DOMMatrixStub {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; is2D = true; isIdentity = true
  constructor(init?: number[]) {
    if (Array.isArray(init) && init.length >= 6) { const [a, b, c, d, e, f] = init as [number, number, number, number, number, number]; Object.assign(this, { a, b, c, d, e, f, isIdentity: false }) }
  }
  multiplySelf() { return this }
  preMultiplySelf() { return this }
  translateSelf() { return this }
  scaleSelf() { return this }
  invertSelf() { return this }
}

export function ensureDOMMatrix(): void {
  const g = globalThis as { DOMMatrix?: unknown }
  if (typeof g.DOMMatrix === 'undefined') g.DOMMatrix = DOMMatrixStub
}
