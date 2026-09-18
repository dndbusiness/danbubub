import { describe, expect, it } from 'vitest'
import { computeInvestorLoan, computeRealEstateSettlement } from '@/lib/rules/realestate.js'
import { sumMoney } from '@/lib/rules/money.js'
import type { Partner, PartnerDraw, Transaction } from '@/lib/rules/types.js'

const DEFAULT_SPLIT = { finance: 0.8, realestate: 0.2 }
const range = { from: '2026-01-01', to: '2026-09-30' }

const partners: Partner[] = [
  { id: 'dan', name: 'דן', division: 'realestate', sharePct: 1 / 3, payMethod: 'invoice' },
  { id: 'aviv', name: 'אביב', division: 'realestate', sharePct: 1 / 3, payMethod: 'invoice' },
  { id: 'yoni', name: 'יוני', division: 'realestate', sharePct: 1 / 3, payMethod: 'payslip' },
]

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: 'tx',
    dateCash: '2026-05-01',
    accountId: 'acc',
    amountNet: 0,
    vatMode: 'excl',
    vatRate: 0.18,
    vatAmount: 0,
    amountGross: 0,
    nature: 'income',
    division: 'realestate',
    txClass: 'business',
    certainty: 'actual',
    invoiceStatus: 'has_invoice',
    ...over,
  }
}

const txs: Transaction[] = [
  tx({ id: 'in-1', amountNet: 300_000, description: 'עמלת יזם' }),
  tx({ id: 'ex-1', nature: 'expense', amountNet: -60_000, deductible: true }),
  // משותפת 80/20 — רק 20% נופלים על נדל"ן
  tx({ id: 'ex-2', nature: 'expense', amountNet: -50_000, division: 'shared', divisionSplit: DEFAULT_SPLIT, deductible: true }),
  // לא מוכרת — יורדת מהתפעולי, לא מהחלוקה (SPEC §3.5 "deductible=1")
  tx({ id: 'ex-3', nature: 'expense', amountNet: -30_000, deductible: false }),
  // נכיון מזומן — מוצג בנפרד, לא מוסתר
  tx({ id: 'in-2', amountNet: 20_000, cashDiscount: true, description: 'נכיון מזומן' }),
]

const draws: PartnerDraw[] = [
  { id: 'd1', date: '2026-03-01', partnerId: 'dan', amount: 60_000, type: 'management_fee' },
  { id: 'd2', date: '2026-03-01', partnerId: 'aviv', amount: 40_000, type: 'management_fee' },
  { id: 'd3', date: '2026-03-01', partnerId: 'yoni', amount: 75_000, type: 'salary', includesEmployerCost: true },
  { id: 'd4', date: '2026-04-01', partnerId: 'yoni', amount: 25_000, type: 'loan_repayment' },
  { id: 'd5', date: '2026-02-01', partnerId: 'dan', amount: 10_000, type: 'owner_loan' },
]

describe('הר-אל השקעות 33/33/33 — SPEC §3.5', () => {
  const result = computeRealEstateSettlement(txs, { range, partners, draws, defaultSplit: DEFAULT_SPLIT })

  it('רווח לחלוקה: הכנסות − הוצאות מוכרות, כולל חלק נדל"ן במשותפות', () => {
    // 300,000 + 20,000 − 60,000 − (50,000×0.2) = 250,000
    expect(result.distributableProfit).toBe(250_000)
  })

  it('הוצאה לא מוכרת אינה מקטינה את הרווח לחלוקה', () => {
    const nonDeductible = txs.find((t) => t.id === 'ex-3')!
    expect(nonDeductible.amountNet).toBe(-30_000)
    expect(result.distributableProfit).toBe(250_000) // ולא 220,000
  })

  it('יעד שוויוני = רווח ÷ 3, בלי לאבד אגורה', () => {
    expect(sumMoney(result.equalTargets)).toBe(250_000)
    expect(result.partners.every((p) => Math.abs(p.target - 83_333.33) < 0.01)).toBe(true)
  })

  it('סטייה = משיכה בפועל − יעד', () => {
    const dan = result.partners.find((p) => p.partnerId === 'dan')!
    const yoni = result.partners.find((p) => p.partnerId === 'yoni')!
    expect(dan.drawn).toBe(60_000)
    expect(dan.variance).toBeLessThan(0) // משך פחות מחלקו
    expect(yoni.drawn).toBe(75_000) // עלות התלוש המלאה, כולל עלות מעביד
  })

  it('החזר הלוואה אינו נספר כמשיכה מול היעד', () => {
    const yoni = result.partners.find((p) => p.partnerId === 'yoni')!
    expect(yoni.drawn).toBe(75_000) // 25,000 ההחזר לא נוסף
  })

  it('חו"ז בעלים = הלוואות בעלים − החזרים', () => {
    const dan = result.partners.find((p) => p.partnerId === 'dan')!
    expect(dan.ownerLoanBalance).toBe(10_000)
  })

  it('נכיון מזומן מוצג בנפרד ולא מוסתר', () => {
    expect(result.cashDiscountIncome).toBe(20_000)
    expect(result.cashDiscountTxIds).toEqual(['in-2'])
  })
})

describe('חוב ליוני 200,000 ₪ — SPEC §3.5', () => {
  it('יתרה = פתיחה − החזרים, עם קצב ירידה', () => {
    const repayments: PartnerDraw[] = [
      { id: 'r1', date: '2026-01-15', partnerId: 'yoni', amount: 10_000, type: 'loan_repayment' },
      { id: 'r2', date: '2026-02-15', partnerId: 'yoni', amount: 10_000, type: 'loan_repayment' },
      { id: 'r3', date: '2026-03-15', partnerId: 'yoni', amount: 10_000, type: 'loan_repayment' },
    ]
    const status = computeInvestorLoan(200_000, repayments, 'yoni')
    expect(status.repaid).toBe(30_000)
    expect(status.balance).toBe(170_000)
    expect(status.averageMonthlyRepayment).toBe(10_000)
    expect(status.monthsToClear).toBe(17)
  })

  it('בלי החזרים אין קצב — null ולא חלוקה באפס', () => {
    const status = computeInvestorLoan(200_000, [], 'yoni')
    expect(status.balance).toBe(200_000)
    expect(status.monthsToClear).toBeNull()
  })
})
