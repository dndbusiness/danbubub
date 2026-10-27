import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** בקרת חשבוניות + מע״מ לתשלום — אותו קוד שרץ במסך (crm/harel-crm.html), בלי DOM. נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ בקרת חשבוניות (דן 27/10)'), b = html.indexOf('/* ══ סוף בקרת חשבוניות ══ */')
const F = new Function(html.slice(a, b) + '; return { ictlParse, ictlMatch, vatDue, vatPeriod, ictlDate };')() as any

const summary = [['דוח מסמכים'], ['מספר המסמך', 'תאריך המסמך', 'סוג המסמך', 'ספק', 'תיאור', 'סכום כולל מע"מ', 'מע"מ', 'סכום לא כולל מע"מ'],
  ['1001', '05/10/2026', 'חשבונית מס', 'Google Ireland', 'קמפיין', '1,180', '180', '1,000'],
  ['1002', '12/10/2026', 'חשבונית מס / קבלה', 'וואיסנטר', '', 472, 72, 400],
  ['1003', '20/10/2026', 'חשבונית זיכוי', 'וואיסנטר', '', 118, 18, 100],
  ['1004', '25/10/2026', 'חשבונית מס', 'ספק בלי תשלום', '', 590, 90, 500]]
const issued = [['מספר מסמך', 'תאריך', 'סוג מסמך', 'לקוח', 'סכום כולל מעמ', 'מעמ'], ['5001', '2026-10-08', 'חשבונית מס / קבלה', 'לקוח א', 11800, 1800]]
const card = [['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב'], ['03/10/26', 'GOOGLE *ADS', 1180, 1180], ['11/10/26', 'וואיסנטר', 472, 472], ['15/10/26', 'מסעדה', 95, 95]]
const bank = [['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'], ['10/10/2026', 'העברה מלקוח א', '', 11800, 50000], ['02/10/2026', 'ישראכרט חיוב', 1747, '', 38200], ['01/10/2026', 'משכורת הדס', 9000, '', 39947]]

describe('בקרת חשבוניות — זיהוי קבצים (דן 27/10)', () => {
  it('קובץ מסכם של הוצאות: ספק, סכום כולל, מע״מ, זיכוי שלילי', () => {
    const r = F.ictlParse(summary, 's.xlsx'); expect(r.kind).toBe('docs'); expect(r.dir).toBe('received'); expect(r.rows).toHaveLength(4)
    expect(r.rows[0]).toMatchObject({ docNo: '1001', date: '2026-10-05', party: 'Google Ireland', gross: 1180, vat: 180 })
    expect(r.rows[2]).toMatchObject({ gross: -118, vat: -18 })
  })
  it('קובץ חשבוניות שהוצאנו (עמודת לקוח)', () => { const r = F.ictlParse(issued, 'i.csv'); expect(r.kind).toBe('docs'); expect(r.dir).toBe('issued') })
  it('דף כרטיס: חיוב = יציאה (שלילי)', () => { const r = F.ictlParse(card, 'c.xlsx'); expect(r.kind).toBe('card'); expect(r.rows[0]).toMatchObject({ date: '2026-10-03', amount: -1180 }) })
  it('דף בנק: זכות − חובה', () => { const r = F.ictlParse(bank, 'b.xlsx'); expect(r.kind).toBe('bank'); expect(r.rows.map((x: any) => x.amount)).toEqual([11800, -1747, -9000]) })
  it('קובץ לא מוכר — שגיאה ברורה', () => { expect(F.ictlParse([['a', 'b'], [1, 2]], 'x.csv').error).toMatch(/לא זוהה/) })
  it('תאריך מאקסל (מספר סידורי)', () => { expect(F.ictlDate(46310)).toBe('2026-10-15') })
})

describe('בקרת חשבוניות — הצלבה', () => {
  const docs = [...F.ictlParse(summary, 's').rows, ...F.ictlParse(issued, 'i').rows]
  const pays = [...F.ictlParse(card, 'c').rows, ...F.ictlParse(bank, 'b').rows]
  const txs = [
    { id: 't1', nature: 'expense', date: '2026-10-03', gross: -1180, invoice: 'pending' },
    { id: 't2', nature: 'expense', date: '2026-10-11', gross: -472, invoice: 'has_invoice' },
    { id: 't3', nature: 'income', date: '2026-10-10', gross: 11800 },
    { id: 't4', nature: 'expense', date: '2026-10-26', gross: -590 },
  ]
  const R = F.ictlMatch(docs, pays, txs)
  it('תשלום בכרטיס ↔ חשבונית; חיוב הכרטיס בבנק לא נספר פעמיים', () => {
    expect(R.out.map((x: any) => [x.pay.desc, x.doc && x.doc.docNo])).toEqual([['משכורת הדס', null], ['GOOGLE *ADS', '1001'], ['וואיסנטר', '1002'], ['מסעדה', null]])
  })
  it('משכורת — לא צריך חשבונית; מסעדה — חסרה חשבונית', () => {
    expect(R.out.find((x: any) => x.pay.desc === 'משכורת הדס').noInv).toBe(true)
    expect(R.out.find((x: any) => x.pay.desc === 'מסעדה').noInv).toBe(false)
  })
  it('תקבול ↔ חשבונית שהוצאנו', () => { expect(R.inn[0].doc.docNo).toBe('5001') })
  it('חשבוניות בלי תשלום: הזיכוי וספק בלי תשלום', () => { expect(R.docsNoPay.map((d: any) => d.docNo).sort()).toEqual(['1003', '1004']) })
  it('מה לסמן במערכת — רק מה שעוד לא מסומן', () => {
    expect(R.updates.map((u: any) => [u.id, u.invoice, u.invoiceRef]).sort()).toEqual([['t1', 'has_invoice', '1001'], ['t3', 'issued', '5001'], ['t4', 'has_invoice', '1004']])
  })
  it('מע״מ מהקובץ: עסקאות − תשומות', () => { expect(R.vat).toEqual({ out: 1800, in: 324, due: 1476 }) })
})

describe('מע״מ לתשלום — דו-חודשי (דן 27/10), מכל ההכנסות, תשומות רק עם חשבונית', () => {
  it('תקופות: ספט׳–אוק׳, נוב׳–דצמ׳ (דיווח בינואר)', () => {
    expect(F.vatPeriod('2026-10')).toEqual({ months: ['2026-09', '2026-10'], label: '09–10/2026', report: '2026-11' })
    expect(F.vatPeriod('2026-09').months).toEqual(['2026-09', '2026-10'])
    expect(F.vatPeriod('2026-12')).toEqual({ months: ['2026-11', '2026-12'], label: '11–12/2026', report: '2027-01' })
  })
  const txs = [
    { nature: 'income', date: '2026-10-05', vat: 1800 }, { nature: 'income', date: '2026-10-20', vat: 900, invoice: 'issued' },
    { nature: 'expense', date: '2026-10-06', vat: -180, invoice: 'has_invoice' }, { nature: 'expense', date: '2026-10-07', vat: -72 },
    { nature: 'expense', date: '2026-10-08', vat: -50, invoice: 'no_invoice_needed' }, { nature: 'expense', date: '2026-10-09', vat: -30, deductible: false },
    { nature: 'income', date: '2026-09-30', vat: 999, invoice: 'issued' }, { nature: 'income', date: '2026-08-31', vat: 555 },
  ]
  it('ספט׳–אוק׳: לתשלום 3,519; אם תגיע החשבונית החסרה — 3,447. אוגוסט בתקופה אחרת', () => {
    expect(F.vatDue(txs, '2026-10')).toEqual({ out: 3699, in: 180, wait: 72, waitN: 1, due: 3519, best: 3447, incNoInv: 1, period: '09–10/2026', report: '2026-11' })
    expect(F.vatDue(txs, '2026-09').due).toBe(3519)
  })
})
