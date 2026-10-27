/**
 * SMS ללקוח עם קישור לחתימה — דרך SLNG (דן, 21/10). הנוסח עצמו יושב ב-SLNG (מענה אוטומטי לקבוצה
 * "שליחת מסמכים - מערכת הראל"): "שלום [שם], מצורף מסמך לחתימה מהראל: [קישור] לשאלות: 053-3351395".
 * כאן — הכללים הטהורים: טלפון נייד ישראלי, שם פרטי, ואורך ההודעה.
 */
/** "052-123-4567" / "+972521234567" / "972521234567" → "0521234567"; לא נייד ישראלי → null */
export function ilMobile(phone: string | null | undefined): string | null {
  let d = String(phone ?? '').replace(/\D/g, '')
  if (d.startsWith('972')) d = '0' + d.slice(3)
  return /^05\d{8}$/.test(d) ? d : null
}

export const firstName = (name: string | null | undefined) => String(name ?? '').trim().split(/\s+/)[0] ?? ''

/** מגבלת SLNG להודעה; החלק הקבוע של הנוסח בלי השם והקישור */
export const SMS_LIMIT = 268
const FIXED = 'שלום , מצורף מסמך לחתימה מהראל:  לשאלות: 053-3351395'
/** הנוסח — אותו נוסח כמו המענה האוטומטי ב-SLNG; נשלח כך כשהחיבור הוא ב-API (דן 27/10) */
export const smsText = (name: string, link: string) => `שלום ${firstName(name)}, מצורף מסמך לחתימה מהראל: ${link} לשאלות: 053-3351395`
export const smsLength = (name: string, link: string) => FIXED.length + firstName(name).length + link.length
export const smsFits = (name: string, link: string) => smsLength(name, link) <= SMS_LIMIT
