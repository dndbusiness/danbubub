import { describe, expect, it } from 'vitest'
import { classifyIntake, extractByRules, extractByTemplate, findSupplier, intakeFileName, learnTemplate, normalizeName } from '@/lib/intake/extract.js'

const suppliers = [
  { id: 's1', name: 'בזק בינלאומי בע"מ', aliases: ['bezeq int', 'בזק'], emails: ['billing@bezeqint.co.il', '@bezeqint.net'] },
  { id: 's2', name: 'משרד עו"ד כהן', aliases: [], emails: [] },
]
const text = `בזק בינלאומי בע"מ
חשבונית מס 1023456   תאריך: 05/09/2026
סה"כ לפני מע"מ 1,000.00
מע"מ 18% 180.00
סה"כ לתשלום 1,180.00 ₪`

describe('חילוץ שדות — ב.3 (הצעה בלבד, הנחיה 17)', () => {
  it('כללים כלליים: מספר מסמך, תאריך, נטו/מע"מ/ברוטו, עקביות', () => {
    const e = extractByRules(text, suppliers[0])
    expect(e).toMatchObject({ docNumber: '1023456', date: '2026-09-05', gross: 1180, vat: 180, net: 1000, currency: 'ILS', method: 'rules', supplierId: 's1' })
    expect(e.confidence).toBeGreaterThanOrEqual(0.9)
    expect(e.warnings).toEqual([])
  })
  it('נטו+מע"מ≠ברוטו → אזהרה וביטחון נמוך יותר', () => {
    const e = extractByRules(text.replace('1,000.00', '900.00'))
    expect(e.warnings[0]).toContain('≠')
    expect(e.confidence).toBeLessThan(0.9)
  })
  it('ספק לפי מייל (כולל דומיין) ולפי alias בטקסט', () => {
    expect(findSupplier({ sender: 'Bezeq <noreply@bezeqint.net>' }, suppliers)?.id).toBe('s1')
    expect(findSupplier({ text: 'קבלה מ-BEZEQ INT' }, suppliers)?.id).toBe('s1')
    expect(findSupplier({ text: 'ספק אחר' }, suppliers)).toBeNull()
    expect(normalizeName('בזק בינלאומי בע"מ')).toBe('בזק בינלאומי')
  })
  it('סינון: חשבונית / דף פירוט (→ תור הייבוא) / לא ידוע', () => {
    expect(classifyIntake({ subject: 'חשבונית מס 1023', fileName: 'inv.pdf' }, suppliers)).toBe('invoice')
    expect(classifyIntake({ subject: 'פירוט חיובים לכרטיס 1234', fileName: 'x.xlsx' }, suppliers)).toBe('statement')
    expect(classifyIntake({ subject: 'שלום', sender: 'billing@bezeqint.co.il' }, suppliers)).toBe('invoice')
    expect(classifyIntake({ subject: 'תמונות מהחופשה', fileName: 'a.pdf' }, suppliers)).toBe('unknown')
  })
  it('תבנית נלמדת מהמסמך המאושר ותופסת את המסמך הבא של אותו ספק', () => {
    const tpl = learnTemplate(text, { docNumber: '1023456', date: '2026-09-05', gross: 1180, vat: 180, net: 1000 })
    expect(tpl.gross).toBeTruthy(); expect(tpl.docNumber).toBeTruthy(); expect(tpl.date).toBeTruthy()
    const next = text.replace('1023456', '1023999').replace('05/09/2026', '05/10/2026').replace('1,180.00', '2,360.00').replace('180.00', '360.00').replace('1,000.00', '2,000.00')
    const e = extractByTemplate(next, { ...suppliers[0]!, extractionTemplate: tpl })
    expect(e.method).toBe('template')
    expect(e).toMatchObject({ docNumber: '1023999', date: '2026-10-05', gross: 2360, vat: 360, net: 2000 })
  })
  it('שם הקובץ בדרייב: {תאריך}_{ספק}_{סכום}.pdf', () => {
    expect(intakeFileName({ date: '2026-09-05', supplierName: 'בזק/בינלאומי', gross: 1180, confidence: 1, method: 'rules', warnings: [] }, 'x.pdf')).toBe('2026-09-05_בזק בינלאומי_1180.00.pdf')
  })
})

describe('טקסט מ-pdf-parse עם סדר RTL הפוך', () => {
  it('מספר מסמך לפני המילה, מע"מ אחרי האחוז, ₪ לפני הסכום', () => {
    const t = 'ספק לדוגמה בע"מ\n7001 חשבונית מס\n03/09/2026 תאריך:\nסה"כ לפני מע"מ\t1,000.00\n18% מע"מ\t180.00\nסה"כ לתשלום\t₪ 1,180.00'
    const e = extractByRules(t)
    expect(e).toMatchObject({ docNumber: '7001', date: '2026-09-03', gross: 1180, vat: 180, net: 1000, supplierName: 'ספק לדוגמה בע"מ' })
  })
})
