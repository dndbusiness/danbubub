/**
 * תזכורות גביה — ADDENDUM ב.6 ("שלח תזכורת: וואטסאפ Green-API עם תבנית / מייל").
 * UIUX §5.7: התבנית מוצגת כ-preview לפני שליחה — ולכן היא פונקציה טהורה שאפשר להציג ולבדוק.
 *
 * הטון מתחמם לפי הגיול, אבל אף פעם לא מאיים: זה לקוח, לא חייב.
 */
import type { AgingBucket } from './collections.js'
import type { IsoDate } from './period.js'

export interface ReminderContext {
  clientName: string
  amount: number
  dueDate: IsoDate | null
  daysOverdue: number
  bucket: AgingBucket
  /** שם החברה בחתימה. */
  companyName?: string
  /** האם כבר הוצאה חשבונית מס — משנה את הניסוח. */
  invoiceIssued?: boolean
  /** קישור לתשלום / לפרטים, אם יש. */
  link?: string
  senderName?: string
}

export interface ReminderMessage {
  subject: string
  whatsapp: string
  emailHtml: string
  /** דרגת ההסלמה — מה שהמסך מציג ליד ה-preview. */
  tone: 'friendly' | 'firm' | 'escalated'
}

const money = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('he-IL')} ₪`
const heDate = (d: IsoDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

export function reminderTone(bucket: AgingBucket): ReminderMessage['tone'] {
  if (bucket === '0-30') return 'friendly'
  if (bucket === '31-60') return 'firm'
  return 'escalated'
}

export function buildCollectionReminder(c: ReminderContext): ReminderMessage {
  const tone = reminderTone(c.bucket)
  const company = c.companyName ?? 'הר-אל פתרונות מימון עסקי'
  const sender = c.senderName ?? 'דן'
  const due = c.dueDate ? heDate(c.dueDate) : null

  const opening =
    tone === 'friendly'
      ? `שלום ${c.clientName}, מקווים שהכול טוב.`
      : tone === 'firm'
        ? `שלום ${c.clientName},`
        : `שלום ${c.clientName},`

  const body =
    tone === 'friendly'
      ? `רצינו להזכיר שיתרת שכר הטרחה על סך ${money(c.amount)}${due ? ` מיועדת לתשלום ב-${due}` : ''}.`
      : tone === 'escalated'
        ? `יתרת שכר הטרחה על סך ${money(c.amount)}${due ? ` מ-${due}` : ''} פתוחה כבר ${c.daysOverdue} יום. נשמח להסדיר אותה או לשמוע אם יש קושי שאפשר לפתור יחד.`
        : `יתרת שכר הטרחה על סך ${money(c.amount)}${due ? ` מ-${due}` : ''} טרם שולמה (${c.daysOverdue} יום).`

  const invoiceLine = c.invoiceIssued ? 'חשבונית המס כבר נשלחה אליכם.' : 'חשבונית מס תישלח עם התשלום.'
  const closing =
    tone === 'escalated'
      ? 'נשמח לעדכון עד סוף השבוע. אם כבר שילמתם — התעלמו מההודעה ועדכנו אותנו.'
      : 'אם כבר שילמתם — התעלמו מההודעה ועדכנו אותנו.'

  const lines = [opening, body, invoiceLine, closing, c.link ?? '', `${sender} · ${company}`].filter(Boolean)

  return {
    subject: `${company} — יתרת שכר טרחה ${money(c.amount)}`,
    whatsapp: lines.join('\n'),
    emailHtml: `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;font-size:14px;color:#111827">${lines
      .map((l) => `<p style="margin:0 0 10px">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
      .join('')}</div>`,
    tone,
  }
}

/** מספר וואטסאפ ישראלי → פורמט בינלאומי. מחזיר null אם לא נראה כמו טלפון. */
export function toInternationalPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = raw.replace(/\D/g, '')
  if (d.startsWith('972') && d.length >= 11) return d
  if (d.startsWith('0') && d.length >= 9) return `972${d.slice(1)}`
  if (d.length === 9) return `972${d}`
  return null
}
