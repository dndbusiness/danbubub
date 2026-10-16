/**
 * צ'קליסט "סגירת חודש לרו"ח" — ADDENDUM ב.7.
 * "כל ✓ אוטומטי מהנתונים" — ולכן זו פונקציה טהורה שמקבלת עובדות ומחזירה מצב.
 * אף פריט אינו נסמן ידנית; מי שרוצה לסמן — מתקן את הנתונים.
 */
import type { IsoMonth } from './period.js'

export type MonthCloseKey =
  | 'bank_and_card_imported'
  | 'no_unknown_transactions'
  | 'no_stale_open_expenses'
  | 'missing_invoices_handled'
  | 'payroll_sent'
  | 'nissim_card_closed'
  | 'pnl_final'
  | 'gaps_report_sent'

export interface MonthCloseItem {
  key: MonthCloseKey
  label: string
  done: boolean
  /** מה חסר בדיוק — מה שמוצג במסך ובאירוע היומן. */
  detail: string
  /** פריט חוסם = בלעדיו אסור לשלוח לרו"ח. */
  blocking: boolean
}

export interface MonthCloseFacts {
  month: IsoMonth
  /** האם יובאה אצווה של בנק/אשראי שנוגעת לחודש. */
  importedBatches: number
  unknownTransactions: number
  /** הוצאות פתוחות בחשבונית ירוקה מעל 30 יום (4.3). */
  staleOpenExpenses: number
  /** תנועות בלי חשבונית שלא סומנו "לא נדרשת". */
  missingInvoices: number
  missingInvoiceVat: number
  payrollSentAt: string | null
  nissimCardClosed: boolean
  pnlFinalAt: string | null
  gapsReportAt: string | null
}

const n = (x: number) => x.toLocaleString('he-IL')

export function computeMonthCloseChecklist(f: MonthCloseFacts): MonthCloseItem[] {
  return [
    {
      key: 'bank_and_card_imported', blocking: true,
      label: 'דפי בנק ואשראי יובאו לחודש',
      done: f.importedBatches > 0,
      detail: f.importedBatches > 0 ? `${f.importedBatches} אצוות יובאו` : 'לא יובאה אף אצווה — התנועות עלולות להיות חלקיות',
    },
    {
      key: 'no_unknown_transactions', blocking: true,
      label: 'אין תנועות לא מזוהות',
      done: f.unknownTransactions === 0,
      detail: f.unknownTransactions === 0 ? 'הכול מסווג' : `${n(f.unknownTransactions)} תנועות ממתינות לסיווג`,
    },
    {
      key: 'no_stale_open_expenses', blocking: false,
      label: 'אין הוצאות פתוחות בחשבונית ירוקה מעל 30 יום',
      done: f.staleOpenExpenses === 0,
      detail: f.staleOpenExpenses === 0 ? 'אין' : `${n(f.staleOpenExpenses)} הוצאות פתוחות`,
    },
    {
      key: 'missing_invoices_handled', blocking: false,
      label: 'חשבוניות חסרות טופלו או סומנו',
      done: f.missingInvoices === 0,
      detail: f.missingInvoices === 0 ? 'אין חשבוניות חסרות' : `${n(f.missingInvoices)} חסרות · ${n(Math.round(f.missingInvoiceVat))} ₪ מע"מ תשומות בסיכון`,
    },
    {
      key: 'payroll_sent', blocking: false,
      label: 'דוח שכר נשלח לרו"ח',
      done: Boolean(f.payrollSentAt),
      detail: f.payrollSentAt ? `נשלח ${f.payrollSentAt.slice(0, 10)}` : 'טרם נשלח (מסך 19 — שלב 8b)',
    },
    {
      key: 'nissim_card_closed', blocking: true,
      label: 'כרטיס ניסים נסגר',
      done: f.nissimCardClosed,
      detail: f.nissimCardClosed ? 'התקופה נעולה' : 'החודש עדיין פתוח — לסגור במסך 7',
    },
    {
      key: 'pnl_final', blocking: true,
      label: 'רווח והפסד סופי הופק',
      done: Boolean(f.pnlFinalAt),
      detail: f.pnlFinalAt ? `הופק ${f.pnlFinalAt.slice(0, 10)}` : 'טרם הופק',
    },
    {
      key: 'gaps_report_sent', blocking: false,
      label: 'קובץ פערים נשלח',
      done: Boolean(f.gapsReportAt),
      detail: f.gapsReportAt ? `נשלח ${f.gapsReportAt.slice(0, 10)}` : 'דוח הפערים (4.3) נבנה בשלב 6',
    },
  ]
}

export interface MonthCloseStatus { items: MonthCloseItem[]; done: number; total: number; blockers: MonthCloseItem[]; ready: boolean }

export function monthCloseStatus(items: readonly MonthCloseItem[]): MonthCloseStatus {
  const blockers = items.filter((i) => i.blocking && !i.done)
  return { items: [...items], done: items.filter((i) => i.done).length, total: items.length, blockers, ready: blockers.length === 0 }
}
