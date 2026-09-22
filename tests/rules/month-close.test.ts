import { describe, expect, it } from 'vitest'
import { computeMonthCloseChecklist, monthCloseStatus, type MonthCloseFacts } from '@/lib/rules/month-close.js'

const clean: MonthCloseFacts = {
  month: '2026-08', importedBatches: 2, unknownTransactions: 0, staleOpenExpenses: 0, missingInvoices: 0, missingInvoiceVat: 0,
  payrollSentAt: '2026-09-01T08:00:00Z', nissimCardClosed: true, pnlFinalAt: '2026-09-12T08:00:00Z', gapsReportAt: '2026-09-12T08:00:00Z',
}

describe('צ׳קליסט סגירת חודש לרו״ח — ADDENDUM ב.7', () => {
  it('שמונה הפריטים של ב.7, כולם ✓ כשהכול נקי', () => {
    const s = monthCloseStatus(computeMonthCloseChecklist(clean))
    expect(s.total).toBe(8)
    expect(s.done).toBe(8)
    expect(s.ready).toBe(true)
    expect(s.blockers).toEqual([])
  })

  it('תנועות לא מזוהות חוסמות, והפירוט אומר כמה', () => {
    const s = monthCloseStatus(computeMonthCloseChecklist({ ...clean, unknownTransactions: 4 }))
    expect(s.ready).toBe(false)
    expect(s.blockers.map((b) => b.key)).toEqual(['no_unknown_transactions'])
    expect(s.items.find((i) => i.key === 'no_unknown_transactions')?.detail).toContain('4 תנועות')
  })

  it('חשבוניות חסרות לא חוסמות אבל מציגות את המע"מ בסיכון', () => {
    const s = monthCloseStatus(computeMonthCloseChecklist({ ...clean, missingInvoices: 7, missingInvoiceVat: 18_428.61 }))
    expect(s.ready).toBe(true)
    expect(s.items.find((i) => i.key === 'missing_invoices_handled')?.detail).toContain('18,429 ₪')
  })

  it('חודש פתוח ו-P&L שלא הופק — שני חסמים', () => {
    const s = monthCloseStatus(computeMonthCloseChecklist({ ...clean, nissimCardClosed: false, pnlFinalAt: null }))
    expect(s.blockers.map((b) => b.key).sort()).toEqual(['nissim_card_closed', 'pnl_final'])
    expect(s.done).toBe(6)
  })

  it('בלי ייבוא — חסם, כי התנועות עלולות להיות חלקיות', () => {
    const s = monthCloseStatus(computeMonthCloseChecklist({ ...clean, importedBatches: 0 }))
    expect(s.ready).toBe(false)
    expect(s.items[0]!.detail).toContain('לא יובאה')
  })
})
