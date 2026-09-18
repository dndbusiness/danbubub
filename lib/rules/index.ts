/**
 * /lib/rules — כל נוסחה מסעיף 3 באפיון, כפונקציה טהורה עם בדיקת יחידה.
 * SPEC §11.3: "כל נוסחה בסעיף 3 = פונקציה טהורה ב-/lib/rules עם בדיקת יחידה."
 *
 * אין כאן I/O, אין `new Date()` ללא ארגומנט, ואין קריאה ל-DB.
 * השכבה שמביאה נתונים יושבת מעל, ב-/lib/queries.
 */

export * from './money.js'
export * from './types.js'
export * from './period.js'
export * from './division.js'
export * from './vat.js'
export * from './attribution.js'
export * from './pnl.js'
export * from './nissim-card.js'
export * from './realestate.js'
export * from './probability.js'
export * from './cashflow.js'
export * from './forecast.js'
export * from './conversion.js'
export * from './payroll.js'
