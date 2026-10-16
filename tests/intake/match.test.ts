import { describe, expect, it } from 'vitest'
import { BANK_MATCH, INVOICE_MATCH, matchTarget } from '@/lib/match/invoices.js'

const txs = [
  { id: 't1', dateCash: '2026-09-05', amountGross: -1180, counterparty: 'בזק בינלאומי בע"מ' },
  { id: 't2', dateCash: '2026-09-20', amountGross: -1180, counterparty: 'PAZ' },
  { id: 't3', dateCash: '2026-08-01', amountGross: -1180.5, counterparty: 'בזק' },
  { id: 't4', dateCash: '2026-09-06', amountGross: -500, counterparty: 'x' },
]

describe('מנוע ההתאמה — §4.2 / ב.3', () => {
  it('חשבונית: ברוטו ±1, 30 יום, ספק מנורמל → התאמה מלאה', () => {
    const r = matchTarget({ amountGross: 1180, date: '2026-09-03', supplierName: 'בזק' }, txs, INVOICE_MATCH)
    expect(r.status).toBe('matched')
    expect(r.best?.tx.id).toBe('t1')
    expect(r.best?.reasons).toContain('ספק תואם')
  })
  it('שני מועמדים בלי ספק → candidates, לא מלאה', () => {
    const r = matchTarget({ amountGross: 1180, date: '2026-09-12' }, txs, INVOICE_MATCH)
    expect(r.status).toBe('candidates')
    expect(r.candidates.map((c) => c.tx.id).sort()).toEqual(['t1', 't2'])
  })
  it('מחוץ לחלון התאריכים / סכום → none', () => {
    expect(matchTarget({ amountGross: 1180, date: '2026-12-01' }, txs, INVOICE_MATCH).status).toBe('none')
    expect(matchTarget({ amountGross: 999, date: '2026-09-05' }, txs, INVOICE_MATCH).status).toBe('none')
  })
  it('דף בנק: ±3 ימים ואותו חשבון', () => {
    const bank = [{ id: 'b1', dateCash: '2026-09-05', amountGross: -1180, accountId: 'A' }, { id: 'b2', dateCash: '2026-09-05', amountGross: -1180, accountId: 'B' }]
    const r = matchTarget({ amountGross: -1180, date: '2026-09-07', accountId: 'A' }, bank, BANK_MATCH)
    expect(r.status).toBe('matched'); expect(r.best?.tx.id).toBe('b1')
    expect(matchTarget({ amountGross: -1180, date: '2026-09-10', accountId: 'A' }, bank, BANK_MATCH).status).toBe('none')
  })
  it('תנועה שכבר משודכת לחשבונית לא מועמדת', () => {
    expect(matchTarget({ amountGross: 500, date: '2026-09-06' }, [{ ...txs[3]!, invoiceId: 'inv' }], INVOICE_MATCH).status).toBe('none')
  })
})
