/** תוויות עברית משותפות למסך, ל-PDF ולמייל — כדי שלא יהיו שני ניסוחים לאותו דבר. */

/** SPEC §4.3 — שלוש בדיקות הפערים. */
export const GAP_LABEL: Record<string, string> = {
  income_without_invoice: 'הכנסה בבנק בלי חשבונית',
  invoice_without_receipt: 'חשבונית שהוצאה בלי תקבול',
  expense_without_invoice: 'הוצאה בלי חשבונית ספק',
}

/** קודי המוצרים כפי שהם ב-DB — לעברית. UI בעברית בלבד (הנחיה 6). */
export const PRODUCT_LABEL: Record<string, string> = {
  mortgage: 'משכנתא',
  mortgage_declined: 'משכנתא לאחר סירוב',
  business_loan: 'הלוואה עסקית',
  business_credit: 'אשראי עסקי',
  vehicle_lien: 'שעבוד רכב',
  realestate: 'נדל״ן',
  other: 'אחר',
}

/** מחליף קוד מוצר שמופיע בתוך טקסט חופשי (למשל בתווית הנחה בתחזית). */
export function withHebrewProducts(text: string): string {
  return Object.entries(PRODUCT_LABEL).reduce(
    (acc, [key, label]) => acc.replace(new RegExp(`\\b${key}\\b`, 'g'), label),
    text,
  )
}
