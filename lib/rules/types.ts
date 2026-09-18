/**
 * טיפוסי הליבה — SPEC §2.
 *
 * הטיפוסים כאן הם *צורת הקלט לפונקציות הכללים*, לא בהכרח ההעתק המדויק של שורת ה-DB.
 * כל פונקציה בסעיף 3 מקבלת את המבנים האלה ומחזירה מספר או פירוק — בלי לגעת ב-DB.
 */

import type { Shekels } from './money.js'

// ── רשימות סגורות (SPEC §2.1, §2.3) ────────────────────────────────────────

/** SPEC §1.3 — רק `expense` ו-`income` נכנסים לרווח והפסד. */
export type Nature =
  | 'income'
  | 'expense'
  | 'financing'
  | 'transfer'
  | 'advance'
  | 'draw'
  | 'vat'
  | 'tax'

/** SPEC §1.2 — הפרדת פעילויות בתוך חשבון אחד. */
export type Division = 'realestate' | 'finance' | 'shared' | 'private'

/** פעילות שאפשר לייחס לה כסף בפועל. `shared` תמיד מתפרק לשתי אלה. */
export type ConcreteDivision = 'realestate' | 'finance'

/** SPEC §1.4 — ברירת מחדל: הסכום הוא ללא מע"מ. */
export type VatMode = 'excl' | 'incl' | 'exempt'

/** SPEC §1.5 — רווח והפסד מציג `actual` בלבד. */
export type Certainty = 'actual' | 'committed' | 'expected'

/** SPEC §2.1 — סיווג סוג העסקה. */
export type TxClass = 'business' | 'vehicle' | 'private'

export type InvoiceStatus = 'has_invoice' | 'missing' | 'no_invoice_needed' | 'unknown'

export type ReviewStatus =
  | 'ok'
  | 'ask_nissim'
  | 'ask_aviv'
  | 'ask_yoni'
  | 'unknown_expense'

export type CategoryKind = 'fixed' | 'direct' | 'variable' | 'owner'

export type DealStatus = 'open' | 'won' | 'lost' | 'cancelled'

/** SPEC §2.3 — שלבי תיק מימון. */
export type FinanceStage =
  | 'prospect'
  | 'signed_collecting_docs'
  | 'submitted'
  | 'approved_in_principle'
  | 'appraisal'
  | 'lawyer_signing'
  | 'execution'
  | 'completed'

/** SPEC §2.3 — שלבי תיק נדל"ן. */
export type RealEstateStage =
  | 're_lead'
  | 're_meeting'
  | 're_proposal'
  | 're_contract_signed'
  | 're_fee_paid'
  | 're_developer_commission_received'
  | 're_closed'

export type DealStage = FinanceStage | RealEstateStage

/** SPEC §2.3 — סטטוס גביה. */
export type CollectionStatus =
  | 'not_collected'
  | 'advance_paid'
  | 'partially_paid'
  | 'fully_paid'
  | 'legal_collection'
  | 'cancelled'

/** SPEC §2.1 — שלבי ליד. */
export type LeadStage =
  | 'received'
  | 'contacted'
  | 'meeting'
  | 'proposal'
  | 'signed'
  | 'closed_won'
  | 'closed_lost'

export type PeriodStatus = 'open' | 'closed'

export type PayType = 'payslip' | 'invoice' | 'freelancer'

// ── מבני קלט ───────────────────────────────────────────────────────────────

/** מפתח חלוקה לפעילות משותפת. SPEC §1.2 — למשל הדס = 80% מימון / 20% נדל"ן. */
export type DivisionSplit = Partial<Record<ConcreteDivision, number>>

/**
 * תנועה — SPEC §2.1 `transactions`.
 * `amountNet` חתום: חיובי נכנס, שלילי יוצא (SPEC §2.1).
 */
export interface Transaction {
  id: string
  /** מתי הכסף זז בפועל. */
  dateCash: string // YYYY-MM-DD
  /** תאריך חשבונית/מסמך. */
  dateDoc?: string
  accountId: string
  amountNet: Shekels
  vatMode: VatMode
  vatRate: number
  vatAmount: Shekels
  amountGross: Shekels
  nature: Nature
  division: Division
  divisionSplit?: DivisionSplit
  categoryId?: string
  txClass: TxClass
  /** "מוכרת לפעילות" — קובע אם נכנסת לרווח לחלוקה. */
  deductible?: boolean
  fixedExpenseId?: string
  dealId?: string
  counterparty?: string
  description?: string
  certainty: Certainty
  /** SPEC §2.1 — אם מלא, השורה היא בת של חיוב אשראי ולא נספרת בתזרים. */
  parentId?: string | null
  invoiceStatus: InvoiceStatus
  reviewStatus?: ReviewStatus
  periodId?: string
  partnerId?: string
  /** SPEC §3.5 — נכיון מזומן מוצג בנפרד בדוח. */
  cashDiscount?: boolean
}

/** SPEC §2.1 `fixed_expenses`. */
export interface FixedExpense {
  id: string
  name: string
  categoryId: string
  division: Division
  divisionSplit?: DivisionSplit
  amountNet: Shekels
  vatMode: VatMode
  frequency: 'monthly' | 'quarterly' | 'yearly' | 'once'
  dayOfMonth: number
  accountId: string
  variable: boolean
  /** SPEC §3.3 — "הוצאה קבועה מאושרת" ל-50/50. */
  approvedByNissim: boolean
  startDate: string
  endDate?: string
  active: boolean
}

/** SPEC §2.1 `deals`. */
export interface Deal {
  id: string
  clientName: string
  division: ConcreteDivision
  product: string
  stage: DealStage
  collectionStatus: CollectionStatus
  feeAgreedNet: Shekels
  feeMode: 'fixed' | 'pct_of_credit' | 'pct_of_property'
  feePct?: number
  baseAmount?: Shekels
  advanceAtSigningNet?: Shekels
  developerCommissionNet?: Shekels
  openingFeeNet?: Shekels
  expectedCloseDate?: string
  probabilityOverride?: number
  leadSourceId?: string
  /** SPEC §3.4 — חודש ההתחשבנות שאליו העסקה משויכת, YYYY-MM. */
  monthAttributed?: string
  ownerUserId?: string
  closerId?: string
  status: DealStatus
  cancelledFeeNet?: Shekels
  /** SPEC §2.3 — ל"רקב" אוטומטי. */
  lastActivityAt?: string
  signedAt?: string
}

/** SPEC §2.1 `deal_payments_plan`. */
export interface DealPaymentPlan {
  id: string
  dealId: string
  label: string
  amountNet: Shekels
  expectedDate: string
  certainty: Exclude<Certainty, 'actual'>
  probability: number
  matchedTxId?: string | null
}

/** SPEC §2.1 `advances` — מקדמות לניסים. */
export interface Advance {
  id: string
  date: string
  /** SPEC §2.1 — מקדמה נרשמת בברוטו (שאלה פתוחה #4). */
  amountGross: Shekels
  method: 'cash' | 'credit_card' | 'transfer'
  txId?: string
  /** חודש הקיזוז, YYYY-MM. */
  period: string
  note?: string
}

/** SPEC §2.1 `partner_draws`. */
export interface PartnerDraw {
  id: string
  date: string
  partnerId: string
  amount: Shekels
  type: 'salary' | 'management_fee' | 'dividend' | 'loan_repayment' | 'owner_loan'
  txId?: string
  /** לתלוש: הסכום כולל עלות מעביד. לחשבונית: ללא מע"מ. SPEC §3.5. */
  includesEmployerCost?: boolean
}

export interface Partner {
  id: string
  name: string
  division: ConcreteDivision
  sharePct: number
  payMethod: 'invoice' | 'payslip'
}

/** SPEC §2.1 `periods`. */
export interface Period {
  id: string
  division: ConcreteDivision
  year: number
  month: number
  status: PeriodStatus
  /** יתרת פתיחה — SPEC §3.3 "מנקים שולחן". */
  openingBalance?: Shekels
  closedAt?: string
  closedBy?: string
  settlementTransferTxId?: string
}

/** SPEC §2.1 `balances` — עוגן יומי. */
export interface Balance {
  date: string
  accountId: string
  balance: Shekels
  availableCredit?: Shekels
  source: 'manual' | 'statement_import'
}

/** SPEC §2.1 `leads`. */
export interface Lead {
  id: string
  date: string
  sourceId: string
  product: string
  stage: LeadStage
  dealId?: string
}

/** SPEC §2.1 `lead_costs`. */
export interface LeadCost {
  id: string
  date: string
  sourceId: string
  amount: Shekels
  txId?: string
}

/** SPEC §2.1 `employment_terms.components`. */
export interface PayComponent {
  name: string
  type: 'per_unit' | 'pct_of_sales' | 'fixed' | 'tiered' | 'conditional_fixed'
  /** ₪ ליחידה / אחוז (0–1) / סכום קבוע. */
  rate?: number
  /** לאיזו כמות הרכיב מתייחס: meetings / sales / hours / leads. */
  unit?: 'meetings' | 'sales' | 'hours' | 'leads'
  /** תקרה על הסכום המחושב. */
  cap?: Shekels
  /** רצפה על הסכום המחושב. */
  floor?: Shekels
  /** ל-`tiered`: מדרגות על הכמות. */
  tiers?: Array<{ from: number; to: number | null; rate: number }>
  /** ל-`conditional_fixed`: סף הכמות. */
  threshold?: number
  /** ל-`pct_of_sales`: על בסיס מה. */
  salesBasis?: 'signed' | 'collected'
  vatMode?: VatMode
}

/** SPEC §2.1 `employment_terms`. */
export interface EmploymentTerms {
  id: string
  employeeId: string
  validFrom: string
  validTo?: string
  baseMode: 'hourly' | 'monthly' | 'none'
  hourlyRate?: number
  monthlyBase?: Shekels
  expectedHours?: number
  components: PayComponent[]
  /** אחוז עלות מעביד משוער (~0.22–0.25). */
  employerCostPct: number
  notes?: string
}

export interface Employee {
  id: string
  name: string
  payType: PayType
  divisionSplit: DivisionSplit
  startDate: string
  endDate?: string
  active: boolean
}

/** SPEC §2.1 `payroll_months`. */
export interface PayrollInputs {
  employeeId: string
  /** YYYY-MM */
  period: string
  hoursWorked?: number
  meetingsCount?: number
  salesCount?: number
  leadsCount?: number
  salesAmountNet?: Shekels
  manualAdjustments?: Array<{ label: string; amount: Shekels; note?: string }>
}

/** הגדרות מערכת — SPEC §5 מסך 18. */
export interface Settings {
  /** SPEC §3.1 — ברירת מחדל 18%. */
  vatRate: number
  /** SPEC §1.2 — מפתח חלוקה ברירת מחדל ל-`shared`. */
  defaultDivisionSplit: DivisionSplit
  /** SPEC §3.3 — אחוז ניסים. */
  nissimSharePct: number
  /** SPEC §3.5 — 33.3% לכל שותף נדל"ן. */
  realEstatePartnerCount: number
  /** SPEC §2.3 — הסתברות לפי שלב. */
  stageProbabilities: Partial<Record<DealStage, number>>
  /** SPEC §3.9 — אחוז עלות מעביד ברירת מחדל. */
  employerCostPct: number
  /** SPEC §5.1 — קו יעד לרווח חודשי. */
  monthlyProfitTarget?: Shekels
}
