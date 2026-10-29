import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** סימולציית עו״ש — אותו קוד שרץ במסך (crm/harel-crm.html). נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ סימולציית עו״ש (דן 29/10)'), b = html.indexOf('/* ══ סוף סימולציית עו״ש ══ */')
const F = new Function(html.slice(a, b) + '; return { oshParseSheet, oshReconcile, oshMerge };')() as any

describe('קריאת דף מכל בנק', () => {
  it('זכות / חובה נפרדים + יתרה (כמו פועלים / לאומי), כותרת לא בשורה הראשונה', () => {
    const r = F.oshParseSheet([['חשבון 12345'], [], ['תאריך', 'תיאור הפעולה', 'אסמכתא', 'בחובה', 'בזכות', "היתרה בש''ח"],
      ['01/10/2026', 'משכורת', '1', '', '12,000.00', '15,000.00'], ['03/10/2026', 'ישראכרט', '2', '4,500.00', '', '10,500.00']])
    expect(r.rows).toEqual([{ date: '2026-10-01', desc: 'משכורת', amount: 12000, balance: 15000, ref: '1' }, { date: '2026-10-03', desc: 'ישראכרט', amount: -4500, balance: 10500, ref: '2' }])
  })
  it('עמודה משותפת "₪ זכות/חובה" עם מינוס בסוף (כמו דיסקונט)', () => {
    const r = F.oshParseSheet([['תאריך', 'יום ערך', 'תיאור התנועה', '₪ זכות/חובה', '₪ יתרה'], ['05/10/2026', '05/10/2026', 'הוראת קבע', '1,200.00-', '8,800.00'], ['06/10/2026', '', 'העברה', '500', '9,300']])
    expect(r.rows.map((x: any) => [x.amount, x.balance])).toEqual([[-1200, 8800], [500, 9300]])
  })
  it('קובץ בלי עמודות מתאימות — שגיאה ברורה', () => { expect(F.oshParseSheet([['שם', 'טלפון'], ['א', '1']]).error).toMatch(/לא זוהו/) })
})

describe('לומד את הדף מהיתרה הרצה', () => {
  it('קובץ חדש→ישן: מזהה את הסדר מהיתרות, כל השורות תואמות, יתרת פתיחה', () => {
    const rows = [{ date: '2026-10-05', desc: 'ג', amount: -300, balance: 9700 }, { date: '2026-10-03', desc: 'ב', amount: 2000, balance: 10000 }, { date: '2026-10-01', desc: 'א', amount: -1000, balance: 8000 }]
    const R = F.oshReconcile(rows)
    expect(R.order).toBe('desc'); expect(R.rows.map((r: any) => r.desc)).toEqual(['א', 'ב', 'ג'])
    expect(R.opening).toBe(9000); expect(R.closing).toBe(9700); expect(R.check).toEqual({ checked: 2, ok: 2, fixed: 0, broken: 0 })
  })
  it('סימן הפוך או סכום שלא נקרא — מתוקן לפי ההפרש ביתרה', () => {
    const R = F.oshReconcile([{ date: '2026-10-01', amount: 1000, balance: 5000 }, { date: '2026-10-02', amount: 400, balance: 4600 }, { date: '2026-10-03', amount: 0, balance: 4850 }])
    expect(R.rows.map((r: any) => [r.amount, r.check])).toEqual([[1000, undefined], [-400, 'fixed'], [250, 'fixed']])
    expect(R.check.fixed).toBe(2)
  })
  it('שורה חסרה באמצע — פער מסומן, לא "מתוקן"', () => {
    const R = F.oshReconcile([{ date: '2026-10-01', amount: 100, balance: 1000 }, { date: '2026-10-05', amount: -50, balance: 700 }])
    expect(R.rows[1].check).toBe('gap'); expect(R.rows[1].gap).toBe(-250); expect(R.rows[1].amount).toBe(-50)
  })
})

describe('כל החשבונות כחשבון אחד', () => {
  const A = { id: 'a', label: 'לאומי', opening: 5000, closing: 3000, rows: [{ date: '2026-10-01', desc: 'משכורת', amount: 10000 }, { date: '2026-10-02', desc: 'העברה לחשבון אחר', amount: -8000 }, { date: '2026-10-10', desc: 'שכר דירה', amount: -4000 }] }
  const B = { id: 'b', label: 'פועלים', opening: 1000, closing: 7500, rows: [{ date: '2026-10-03', desc: 'העברה מלאומי', amount: 8000 }, { date: '2026-10-12', desc: 'כרטיס', amount: -1500 }] }
  it('העברה בין החשבונות מסומנת פנימית ולא נספרת; היתרה הסופית = סכום יתרות החשבונות', () => {
    const M = F.oshMerge([A, B], {}, [], null)
    expect(M.internal).toBe(2); expect(M.opening).toBe(6000); expect(M.closing).toBe(10500); expect(M.actualClosing).toBe(10500)
    expect(M.inn).toBe(10000); expect(M.out).toBe(5500)
    expect(M.rows.map((r: any) => [r.desc, r.internal, r.bal])).toEqual([['משכורת', false, 16000], ['העברה לחשבון אחר', true, 16000], ['העברה מלאומי', true, 16000], ['שכר דירה', false, 12000], ['כרטיס', false, 10500]])
  })
  it('סכום מדומה + הערה בתנועה, תנועה מדומה, והוצאה מהחישוב — היתרה הרצה מתעדכנת', () => {
    const M = F.oshMerge([A, B], { 'a:2': { sim: -2500, note: 'רק חצי מהשכירות' }, 'b:1': { off: true } }, [{ id: 'x', date: '2026-10-15', desc: 'הלוואה חדשה', amount: -1000 }], 0)
    expect(M.opening).toBe(0)
    expect(M.rows.find((r: any) => r.k === 'a:2')).toMatchObject({ eff: -2500, note: 'רק חצי מהשכירות' })
    expect(M.rows.find((r: any) => r.k === 'b:1').eff).toBe(0)
    expect(M.closing).toBe(10000 - 2500 - 1000); expect(M.minBal).toBe(0)
  })
  it('אפשר לבטל סימון "פנימית"', () => {
    const M = F.oshMerge([A, B], { 'a:1': { internal: false } }, [], null)
    expect(M.internal).toBe(0); expect(M.closing).toBe(10500)
  })
  it('יתרה שלילית נספרת בימים', () => {
    const M = F.oshMerge([{ id: 'z', opening: 100, rows: [{ date: '2026-10-01', amount: -300 }, { date: '2026-10-02', amount: 50 }, { date: '2026-10-04', amount: 500 }] }], {}, [], null)
    expect(M.negDays).toBe(2); expect(M.minBal).toBe(-200); expect(M.minDate).toBe('2026-10-01')
  })
})
