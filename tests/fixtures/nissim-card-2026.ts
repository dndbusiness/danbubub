/**
 * פיקסצ'ר כרטיס ניסים — יולי/אוגוסט/ספטמבר 2026.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ מקור המספרים והמגבלה שלו — לקרוא לפני שמסתמכים על הקובץ הזה             │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ *יעדי* החישוב לקוחים מ-SPEC §8:                                          │
 * │   יולי −28,262 · אוגוסט 105,882 · ספטמבר 22,447 (רווח לחלוקה)           │
 * │   יתרת ניסים בסוף ספטמבר: 36,517                                         │
 * │                                                                          │
 * │ *הפירוט* שמוביל אליהם (שורות ההכנסה וההוצאה, גובה המקדמות, יתרת          │
 * │ הפתיחה) הוא **שחזור** — הקובץ "הר-אל פתרונות מימון 2026" לא היה זמין     │
 * │ בעת כתיבת הבדיקה. הפירוט נבנה כך שיפיק בדיוק את ארבעת היעדים, וכך        │
 * │ שיעבור דרך כל הענפים של §3.3 (shared×split, לא-מוכרת, קבועה לא           │
 * │ מאושרת, advance/draw, תקבול שני בחודש אחר).                              │
 * │                                                                          │
 * │ מה זה מוכיח: שהנוסחאות של §3.3 + §3.4 מחזירות את המספרים הנכונים         │
 * │ בהינתן שורות נכונות, ושרעש (משיכות, פרטי, נדל"ן) לא דולף פנימה.          │
 * │ מה זה **לא** מוכיח: שהשורות עצמן תואמות לקובץ האמיתי.                    │
 * │                                                                          │
 * │ TODO(שלב 0/2): להחליף את הגוף הזה בייצוא אמיתי מהקובץ הקיים.             │
 * │ עד אז קריטריון הסיום של שלב 1 נחשב "עובר על שחזור", לא "עובר על          │
 * │ הנתונים האמיתיים". ראו docs/OPEN_QUESTIONS.md.                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type {
  Advance,
  Deal,
  DivisionSplit,
  FixedExpense,
  Transaction,
} from '@/lib/rules/types.js'

/** SPEC §8 — התוצאות חייבות להשתוות לשקל. */
export const TARGETS = {
  '2026-07': -28_262,
  '2026-08': 105_882,
  '2026-09': 22_447,
} as const

export const TARGET_CLOSING_BALANCE = 36_517

/** יתרת הפתיחה שגוזרת את היעד: 29,550.50 + 57,000 מקדמות − 50,033.50 חלק ניסים. */
export const OPENING_BALANCE = 29_550.5

/** SPEC §1.2 — הדס = 80% מימון / 20% נדל"ן. */
export const DEFAULT_SPLIT: DivisionSplit = { finance: 0.8, realestate: 0.2 }

const VAT = 0.18

let seq = 0
const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(3, '0')}`

interface TxSeed {
  date: string
  amount: number
  nature: Transaction['nature']
  division?: Transaction['division']
  split?: DivisionSplit
  dealId?: string
  fixedExpenseId?: string
  deductible?: boolean
  description: string
  categoryId?: string
  parentId?: string
  reviewStatus?: Transaction['reviewStatus']
}

function tx(seed: TxSeed): Transaction {
  const net = seed.amount
  const vatAmount = Math.round(net * VAT * 100) / 100
  return {
    id: nextId('tx'),
    dateCash: seed.date,
    accountId: 'acc-bank',
    amountNet: net,
    vatMode: 'excl',
    vatRate: VAT,
    vatAmount,
    amountGross: Math.round((net + vatAmount) * 100) / 100,
    nature: seed.nature,
    division: seed.division ?? 'finance',
    divisionSplit: seed.split,
    categoryId: seed.categoryId ?? 'cat-general',
    txClass: 'business',
    deductible: seed.deductible ?? (seed.nature === 'expense' ? true : undefined),
    fixedExpenseId: seed.fixedExpenseId,
    dealId: seed.dealId,
    description: seed.description,
    certainty: 'actual',
    parentId: seed.parentId ?? null,
    invoiceStatus: 'has_invoice',
    reviewStatus: seed.reviewStatus ?? 'ok',
  }
}

// ── הוצאות קבועות ──────────────────────────────────────────────────────────

export const fixedExpenses: FixedExpense[] = [
  fixed('fx-rent', 'שכירות משרד', 'finance', 8_000, 1, true),
  fixed('fx-salaries', 'שכר', 'finance', 30_000, 9, true),
  fixed('fx-software', 'תוכנה ומערכות', 'shared', 5_000, 5, true),
  fixed('fx-accountant', 'רו"ח', 'finance', 3_000, 15, true),
  fixed('fx-hadas', 'הדס — בק אופיס', 'shared', 20_327.5, 9, true),
  fixed('fx-misc', 'שונות מוכרות', 'finance', 1_118, 20, true),
  // SPEC §3.2 / שאלה פתוחה #3 — לא מאושרת: נכנסת לרווח התפעולי, לא לחלוקה.
  fixed('fx-unapproved', 'מנוי לא מאושר', 'finance', 2_500, 12, false),
]

function fixed(
  id: string,
  name: string,
  division: FixedExpense['division'],
  amountNet: number,
  dayOfMonth: number,
  approvedByNissim: boolean,
): FixedExpense {
  return {
    id,
    name,
    categoryId: 'cat-fixed',
    division,
    divisionSplit: division === 'shared' ? DEFAULT_SPLIT : undefined,
    amountNet,
    vatMode: 'excl',
    frequency: 'monthly',
    dayOfMonth,
    accountId: 'acc-bank',
    variable: false,
    approvedByNissim,
    startDate: '2026-01-01',
    active: true,
  }
}

// ── תיקים ──────────────────────────────────────────────────────────────────

export const deals: Deal[] = [
  deal('deal-jul-1', 'לקוח יולי א׳', '2026-07', 68_000, '2026-07-02'),
  deal('deal-jul-2', 'לקוח יולי ב׳', '2026-07', 15_000, '2026-07-10'),
  deal('deal-aug-1', 'לקוח אוגוסט א׳', '2026-08', 100_000, '2026-08-03'),
  deal('deal-aug-2', 'לקוח אוגוסט ב׳', '2026-08', 50_000, '2026-08-11'),
  deal('deal-aug-3', 'לקוח אוגוסט ג׳', '2026-08', 30_000, '2026-08-20'),
  deal('deal-sep-1', 'לקוח ספטמבר א׳', '2026-09', 60_000, '2026-09-05'),
]

function deal(
  id: string,
  clientName: string,
  monthAttributed: string,
  feeAgreedNet: number,
  signedAt: string,
): Deal {
  return {
    id,
    clientName,
    division: 'finance',
    product: 'business_credit',
    stage: 'completed',
    collectionStatus: 'fully_paid',
    feeAgreedNet,
    feeMode: 'fixed',
    monthAttributed,
    status: 'won',
    signedAt,
    lastActivityAt: signedAt,
  }
}

// ── תנועות ─────────────────────────────────────────────────────────────────

export const transactions: Transaction[] = [
  // ══ יולי: 45,000 הכנסות − 61,262 קבועות − 12,000 ישירות = −28,262 ═══════
  tx({ date: '2026-07-08', amount: 30_000, nature: 'income', dealId: 'deal-jul-1', description: 'מקדמה בחתימה' }),
  tx({ date: '2026-07-21', amount: 15_000, nature: 'income', dealId: 'deal-jul-2', description: 'שכ"ט' }),

  tx({ date: '2026-07-01', amount: -8_000, nature: 'expense', fixedExpenseId: 'fx-rent', description: 'שכירות' }),
  tx({ date: '2026-07-09', amount: -30_000, nature: 'expense', fixedExpenseId: 'fx-salaries', description: 'שכר' }),
  tx({ date: '2026-07-05', amount: -5_000, nature: 'expense', fixedExpenseId: 'fx-software', division: 'shared', split: DEFAULT_SPLIT, description: 'תוכנה' }),
  tx({ date: '2026-07-15', amount: -3_000, nature: 'expense', fixedExpenseId: 'fx-accountant', description: 'רו"ח' }),
  tx({ date: '2026-07-09', amount: -20_327.5, nature: 'expense', fixedExpenseId: 'fx-hadas', division: 'shared', split: DEFAULT_SPLIT, description: 'הדס' }),

  tx({ date: '2026-07-14', amount: -7_000, nature: 'expense', dealId: 'deal-jul-1', description: 'שמאות' }),
  tx({ date: '2026-07-18', amount: -5_000, nature: 'expense', dealId: 'deal-jul-2', description: 'עו"ד' }),

  // רעש שאסור שייכנס לשורות 1–3:
  tx({ date: '2026-07-12', amount: -2_500, nature: 'expense', fixedExpenseId: 'fx-unapproved', description: 'מנוי לא מאושר' }),
  tx({ date: '2026-07-22', amount: -1_500, nature: 'expense', deductible: false, description: 'קנס חניה — לא מוכרת' }),
  tx({ date: '2026-07-19', amount: -19_000, nature: 'advance', description: 'מקדמה לניסים' }),
  tx({ date: '2026-07-25', amount: -12_000, nature: 'draw', description: 'משיכת שותף' }),
  tx({ date: '2026-07-03', amount: -900, nature: 'expense', division: 'private', description: 'הוצאה פרטית בכרטיס' }),
  tx({ date: '2026-07-06', amount: 40_000, nature: 'income', division: 'realestate', dealId: 'deal-re-1', description: 'עמלת יזם — נדל"ן' }),
  tx({ date: '2026-07-28', amount: -50_000, nature: 'transfer', description: 'העברה בין חשבונות' }),

  // ══ אוגוסט: 180,000 − 62,118 − 12,000 = 105,882 ═════════════════════════
  tx({ date: '2026-08-06', amount: 100_000, nature: 'income', dealId: 'deal-aug-1', description: 'שכ"ט' }),
  tx({ date: '2026-08-14', amount: 50_000, nature: 'income', dealId: 'deal-aug-2', description: 'שכ"ט' }),
  tx({ date: '2026-08-24', amount: 30_000, nature: 'income', dealId: 'deal-aug-3', description: 'שכ"ט' }),

  tx({ date: '2026-08-01', amount: -8_000, nature: 'expense', fixedExpenseId: 'fx-rent', description: 'שכירות' }),
  tx({ date: '2026-08-09', amount: -30_000, nature: 'expense', fixedExpenseId: 'fx-salaries', description: 'שכר' }),
  tx({ date: '2026-08-05', amount: -5_000, nature: 'expense', fixedExpenseId: 'fx-software', division: 'shared', split: DEFAULT_SPLIT, description: 'תוכנה' }),
  tx({ date: '2026-08-15', amount: -3_000, nature: 'expense', fixedExpenseId: 'fx-accountant', description: 'רו"ח' }),
  tx({ date: '2026-08-09', amount: -20_000, nature: 'expense', fixedExpenseId: 'fx-hadas', division: 'shared', split: DEFAULT_SPLIT, description: 'הדס' }),
  tx({ date: '2026-08-20', amount: -1_118, nature: 'expense', fixedExpenseId: 'fx-misc', description: 'שונות' }),

  tx({ date: '2026-08-12', amount: -6_000, nature: 'expense', dealId: 'deal-aug-1', description: 'דוח BDI' }),
  tx({ date: '2026-08-19', amount: -4_000, nature: 'expense', dealId: 'deal-aug-2', description: 'שמאות' }),
  tx({ date: '2026-08-26', amount: -2_000, nature: 'expense', dealId: 'deal-aug-3', description: 'נסח טאבו' }),

  tx({ date: '2026-08-19', amount: -19_000, nature: 'advance', description: 'מקדמה לניסים' }),

  // ══ ספטמבר: 98,000 − 61,553 − 14,000 = 22,447 ═══════════════════════════
  tx({ date: '2026-09-09', amount: 60_000, nature: 'income', dealId: 'deal-sep-1', description: 'שכ"ט' }),
  // SPEC §3.4 — תקבול שני של תיק יולי, נספר בספטמבר ולא ביולי (ליקוי #3).
  tx({ date: '2026-09-22', amount: 38_000, nature: 'income', dealId: 'deal-jul-1', description: 'יתרת שכ"ט — success fee' }),

  tx({ date: '2026-09-01', amount: -8_000, nature: 'expense', fixedExpenseId: 'fx-rent', description: 'שכירות' }),
  tx({ date: '2026-09-09', amount: -30_000, nature: 'expense', fixedExpenseId: 'fx-salaries', description: 'שכר' }),
  tx({ date: '2026-09-05', amount: -5_000, nature: 'expense', fixedExpenseId: 'fx-software', division: 'shared', split: DEFAULT_SPLIT, description: 'תוכנה' }),
  tx({ date: '2026-09-15', amount: -3_000, nature: 'expense', fixedExpenseId: 'fx-accountant', description: 'רו"ח' }),
  tx({ date: '2026-09-09', amount: -20_000, nature: 'expense', fixedExpenseId: 'fx-hadas', division: 'shared', split: DEFAULT_SPLIT, description: 'הדס' }),
  tx({ date: '2026-09-20', amount: -553, nature: 'expense', fixedExpenseId: 'fx-misc', description: 'שונות' }),

  tx({ date: '2026-09-11', amount: -14_000, nature: 'expense', dealId: 'deal-sep-1', description: 'הוצאות ישירות' }),

  tx({ date: '2026-09-18', amount: -19_000, nature: 'advance', description: 'מקדמה לניסים' }),
]

// ── מקדמות ─────────────────────────────────────────────────────────────────

export const advances: Advance[] = [
  { id: 'adv-07', date: '2026-07-19', amountGross: 19_000, method: 'credit_card', period: '2026-07' },
  { id: 'adv-08', date: '2026-08-19', amountGross: 19_000, method: 'credit_card', period: '2026-08' },
  { id: 'adv-09', date: '2026-09-18', amountGross: 19_000, method: 'cash', period: '2026-09' },
]

export const MONTHS = ['2026-07', '2026-08', '2026-09'] as const
