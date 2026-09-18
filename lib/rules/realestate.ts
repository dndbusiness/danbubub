/**
 * הר-אל השקעות נדל"ן — 33/33/33. SPEC §3.5.
 *
 *   רווח_לחלוקה_נדל"ן(M) = income actual (realestate)
 *                          − expense actual (realestate + shared×split), deductible=1
 *   יעד_משיכה_שוויוני(YTD) = Σ רווח_לחלוקה_YTD / 3
 *   משיכה_בפועל(שותף)      = Σ partner_draws (salary+management_fee+dividend), YTD
 *      • יוני: עלות תלוש כולל עלות מעביד (יוני + נדיה יחד)
 *      • דן/אביב: חשבונית — הסכום ללא מע"מ
 *   סטייה(שותף)  = משיכה_בפועל − יעד
 *   חו"ז_בעלים   = Σ owner_loan − Σ loan_repayment
 *   חוב_ליוני     = 200,000 (פתיחה) − Σ repayments
 */

import { absMoney, allocateMoney, divMoney, subMoney, sumBy, type Shekels } from './money.js'
import { computePnl } from './pnl.js'
import { inRange, type DateRange } from './period.js'
import type { DivisionSplit, Partner, PartnerDraw, Transaction } from './types.js'

/** SPEC §3.5 — רק אלה נספרים כמשיכה מול היעד. */
const DRAW_TYPES_COUNTED = new Set<PartnerDraw['type']>(['salary', 'management_fee', 'dividend'])

export interface PartnerPosition {
  partnerId: string
  name: string
  /** Σ משיכות YTD מהסוגים שנספרים. */
  drawn: Shekels
  /** היעד השוויוני לשותף. */
  target: Shekels
  /** משיכה בפועל − יעד. חיובי = משך יותר מחלקו. */
  variance: Shekels
  /** חו"ז בעלים: Σ owner_loan − Σ loan_repayment. */
  ownerLoanBalance: Shekels
}

export interface RealEstateSettlement {
  range: DateRange
  distributableProfit: Shekels
  /** רווח לחלוקה ÷ מספר השותפים, ללא איבוד אגורה. */
  equalTargets: Shekels[]
  partners: PartnerPosition[]
  /** SPEC §3.5 — נכיון מזומן מוצג בנפרד בדוח, לא מוסתר. */
  cashDiscountIncome: Shekels
  cashDiscountTxIds: string[]
}

export interface RealEstateOptions {
  range: DateRange
  partners: readonly Partner[]
  draws: readonly PartnerDraw[]
  defaultSplit: DivisionSplit
}

export function computeRealEstateSettlement(
  txs: readonly Transaction[],
  opts: RealEstateOptions,
): RealEstateSettlement {
  const { range, partners, draws, defaultSplit } = opts

  // רווח לחלוקה בנדל"ן: אין דרישת "מאושר" — רק deductible (§3.5 מול §3.2).
  const pnl = computePnl(txs, {
    mode: 'operational',
    division: 'realestate',
    defaultSplit,
    range,
    requireApproval: false,
  })

  // §3.5 דורש deductible=1 גם בנדל"ן, ולכן מנכים בחזרה את הלא-מוכרות.
  const nonDeductible = absMoney(
    sumBy(
      txs.filter(
        (tx) =>
          tx.nature === 'expense' &&
          tx.certainty === 'actual' &&
          tx.deductible === false &&
          inRange(tx.dateCash, range),
      ),
      (tx) => shareForRealEstate(tx, defaultSplit),
    ),
  )
  const distributableProfit = pnl.profit + nonDeductible

  const drawsInRange = draws.filter((d) => inRange(d.date, range))
  const equalTargets = allocateMoney(
    distributableProfit,
    partners.map(() => 1),
  )

  const positions: PartnerPosition[] = partners.map((partner, i) => {
    const mine = drawsInRange.filter((d) => d.partnerId === partner.id)
    const drawn = absMoney(
      sumBy(
        mine.filter((d) => DRAW_TYPES_COUNTED.has(d.type)),
        (d) => d.amount,
      ),
    )
    const ownerLoans = sumBy(
      mine.filter((d) => d.type === 'owner_loan'),
      (d) => absMoney(d.amount),
    )
    const repayments = sumBy(
      mine.filter((d) => d.type === 'loan_repayment'),
      (d) => absMoney(d.amount),
    )
    const target = equalTargets[i] ?? 0
    return {
      partnerId: partner.id,
      name: partner.name,
      drawn,
      target,
      variance: subMoney(drawn, target),
      ownerLoanBalance: subMoney(ownerLoans, repayments),
    }
  })

  const cashDiscountTxs = txs.filter(
    (tx) =>
      tx.cashDiscount === true && tx.nature === 'income' && tx.certainty === 'actual' && inRange(tx.dateCash, range),
  )

  return {
    range,
    distributableProfit,
    equalTargets,
    partners: positions,
    cashDiscountIncome: sumBy(cashDiscountTxs, (tx) => tx.amountNet),
    cashDiscountTxIds: cashDiscountTxs.map((tx) => tx.id),
  }
}

/**
 * חוב ליוני (משקיע) — SPEC §3.5: 200,000 ₪ פתיחה פחות ההחזרים,
 * "מוצג עם קצב ירידה".
 */
export interface InvestorLoanStatus {
  openingBalance: Shekels
  repaid: Shekels
  balance: Shekels
  /** ממוצע החזר חודשי על פני החודשים שבהם היה החזר. */
  averageMonthlyRepayment: Shekels
  /** כמה חודשים נותרו בקצב הנוכחי. null אם אין החזרים. */
  monthsToClear: number | null
}

export function computeInvestorLoan(
  openingBalance: Shekels,
  draws: readonly PartnerDraw[],
  partnerId: string,
): InvestorLoanStatus {
  const repayments = draws.filter((d) => d.partnerId === partnerId && d.type === 'loan_repayment')
  const repaid = sumBy(repayments, (d) => absMoney(d.amount))
  const balance = subMoney(openingBalance, repaid)

  const months = new Set(repayments.map((d) => d.date.slice(0, 7)))
  const averageMonthlyRepayment = months.size ? divMoney(repaid, months.size) : 0
  const monthsToClear =
    averageMonthlyRepayment > 0 ? Math.ceil(balance / averageMonthlyRepayment) : null

  return { openingBalance, repaid, balance, averageMonthlyRepayment, monthsToClear }
}

function shareForRealEstate(tx: Transaction, defaultSplit: DivisionSplit): Shekels {
  if (tx.division === 'realestate') return tx.amountNet
  if (tx.division === 'shared') {
    const split = tx.divisionSplit ?? defaultSplit
    const w = split.realestate ?? 0
    return tx.amountNet * w
  }
  return 0
}
