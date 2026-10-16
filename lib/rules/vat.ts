/**
 * מע"מ — SPEC §1.4 + §3.1.
 *
 * כלל: "ברירת מחדל: סכום ללא מע"מ. המערכת שומרת תמיד גם amount_net,
 * גם amount_gross וגם vat_amount." המע"מ מחושב פעם אחת בכתיבה (SPEC §11.5)
 * — הפונקציה כאן היא אותו חישוב, והיא גם זו שרצה ב-trigger של ה-DB.
 */

import { absMoney, addMoney, mulMoney, round2, subMoney, sumBy, type Shekels } from './money.js'
import type { Certainty, Transaction, VatMode } from './types.js'

export interface VatBreakdown {
  amountNet: Shekels
  vatAmount: Shekels
  amountGross: Shekels
}

/**
 * פירוק סכום למע"מ.
 *
 * @param amount  הסכום כפי שהוזן. ב-`excl`/`exempt` זה הנטו, ב-`incl` זה הברוטו.
 *                חתום: חיובי נכנס, שלילי יוצא.
 * @param vatMode מתג "הסכום כולל מע"מ" במסך ההזנה — ברירת מחדל `excl` (כבוי).
 * @param vatRate שיעור המע"מ כשבר (0.18), מההגדרות לפי תאריך.
 */
export function computeVat(amount: Shekels, vatMode: VatMode, vatRate: number): VatBreakdown {
  if (vatRate < 0 || vatRate >= 1) {
    throw new RangeError(`computeVat: שיעור מע"מ לא חוקי ${vatRate} (צפוי שבר, למשל 0.18)`)
  }

  switch (vatMode) {
    case 'exempt': {
      const net = round2(amount)
      return { amountNet: net, vatAmount: 0, amountGross: net }
    }
    case 'excl': {
      const net = round2(amount)
      const vat = mulMoney(net, vatRate)
      return { amountNet: net, vatAmount: vat, amountGross: addMoney(net, vat) }
    }
    case 'incl': {
      const gross = round2(amount)
      const net = mulMoney(gross, 1 / (1 + vatRate))
      return { amountNet: net, vatAmount: subMoney(gross, net), amountGross: gross }
    }
  }
}

/**
 * שיעור המע"מ שבתוקף בתאריך נתון.
 * SPEC §3.1: "vat_rate בהגדרות (18%). היסטוריה של שיעורים לפי תאריך."
 */
export interface VatRatePeriod {
  from: string // YYYY-MM-DD, כולל
  rate: number
}

export function vatRateOn(date: string, history: readonly VatRatePeriod[]): number {
  const applicable = history
    .filter((p) => p.from <= date)
    .sort((a, b) => (a.from < b.from ? 1 : -1))[0]
  if (!applicable) {
    throw new RangeError(`vatRateOn: אין שיעור מע"מ מוגדר לתאריך ${date}`)
  }
  return applicable.rate
}

// ── חבות מע"מ (SPEC §3.1) ──────────────────────────────────────────────────

export interface VatLiability {
  /** Σ vat_amount על הכנסות actual בתקופה — מע"מ עסקאות. */
  outputVat: Shekels
  /** Σ vat_amount על הוצאות actual *שיש להן חשבונית* — מע"מ תשומות שניתן לקזז. */
  inputVatClaimable: Shekels
  /** מע"מ תשומות שחסר לו חשבונית — "כמה כסף אתה מפסיד אם לא תשיג אותן". */
  inputVatMissingInvoice: Shekels
  /** חבות נטו: חיובי = חייבים למע"מ, שלילי = מע"מ להחזר. */
  liability: Shekels
  /** מספר ההוצאות שחסרה להן חשבונית — מזין את מסך 12 ואת יצירת המשימות. */
  missingInvoiceCount: number
}

export interface VatPeriodRange {
  /** YYYY-MM-DD, כולל. */
  from: string
  /** YYYY-MM-DD, כולל. */
  to: string
}

/**
 * חבות המע"מ בכל רגע — SPEC §3.1:
 *   Σ vat על הכנסות actual − Σ vat על הוצאות actual שיש להן חשבונית.
 *
 * `private` מוחרג: הכנסות פרייבט מקרנות נרשמות ב-`private_income` בלבד
 * ולא נכנסות לחישוב מע"מ החברה.
 */
export function computeVatLiability(
  txs: readonly Transaction[],
  range: VatPeriodRange,
): VatLiability {
  const inPeriod = txs.filter(
    (tx) =>
      tx.certainty === ('actual' satisfies Certainty) &&
      tx.division !== 'private' &&
      // שורת-בת של אשראי לא נושאת מע"מ משלה בנפרד מהאב אלא אם סווגה כך;
      // לצורך מע"מ לוקחים את רמת הסיווג, שם יושבת החשבונית.
      inVatWindow(tx, range),
  )

  const income = inPeriod.filter((tx) => tx.nature === 'income')
  const expenses = inPeriod.filter((tx) => tx.nature === 'expense')

  const withInvoice = expenses.filter((tx) => tx.invoiceStatus === 'has_invoice')
  const missing = expenses.filter(
    (tx) => tx.invoiceStatus === 'missing' || tx.invoiceStatus === 'unknown',
  )

  const outputVat = absMoney(sumBy(income, (tx) => tx.vatAmount))
  const inputVatClaimable = absMoney(sumBy(withInvoice, (tx) => tx.vatAmount))
  const inputVatMissingInvoice = absMoney(sumBy(missing, (tx) => tx.vatAmount))

  return {
    outputVat,
    inputVatClaimable,
    inputVatMissingInvoice,
    liability: subMoney(outputVat, inputVatClaimable),
    missingInvoiceCount: missing.length,
  }
}

/**
 * תאריך שיוך לתקופת המע"מ.
 * ברירת מחדל: `dateDoc` (תאריך המסמך) אם קיים, אחרת `dateCash`.
 * SPEC §4.3 מציין שבחשבונית ירוקה "חודש דיווח ≠ חודש המסמך לפעמים —
 * זה חודש המע"מ", ולכן שדה זה נשמר בנפרד ב-`invoices.vat_period`;
 * כאן נשענים על המסמך, ובייבוא הוא נדרס מהעמודה המפורשת.
 */
function inVatWindow(tx: Transaction, range: VatPeriodRange): boolean {
  const date = tx.dateDoc ?? tx.dateCash
  return date >= range.from && date <= range.to
}
