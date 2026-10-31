import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** סימולציית עו״ש — אותו קוד שרץ במסך (crm/harel-crm.html). נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ סימולציית עו״ש (דן 29/10)'), b = html.indexOf('/* ══ סוף סימולציית עו״ש ══ */')
const F = new Function(html.slice(a, b) + '; return { oshParseSheet, oshReconcile, oshMerge, oshChanges, oshLogic, oshNextBiz };')() as any

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

/* דן 31/10: עריכה מלאה, סיכום מה שונה, הלוגיקה וההצלבה */
const ACC = [
  { id: 'a', label: 'לאומי', opening: 1000, closing: 1700, check: { checked: 2, ok: 2, fixed: 0, broken: 0 }, rows: [
    { date: '2026-10-01', desc: 'משכורת', amount: 2000, balance: 3000 }, { date: '2026-10-02', desc: 'ויזה', amount: -1500, balance: 1500 }, { date: '2026-10-08', desc: 'העברה לדיסקונט', amount: -300, balance: 1200 }] },
  { id: 'b', label: 'דיסקונט', opening: 0, closing: 300, rows: [{ date: '2026-10-09', desc: 'העברה מלאומי', amount: 300, balance: 300 }] },
]
describe('עריכה מלאה וסיכום שינויים', () => {
  it('שם, תאריך, סכום וכיוון (כניסה↔יציאה) — הסדר לפי התאריך אחרי העריכה', () => {
    const M = F.oshMerge(ACC, { 'a:1': { desc: 'ויזה — עסקאות', sim: 1500 }, 'a:0': { date: '2026-10-05' } }, [], null)
    expect(M.rows.map((r: any) => r.desc)).toEqual(['ויזה — עסקאות', 'משכורת', 'העברה לדיסקונט', 'העברה מלאומי'])
    expect(M.rows[0].eff).toBe(1500); expect(M.closing).toBe(1000 + 1500 + 2000)
  })
  it('סיכום: רק השורות שנגעתי בהן, ההשפעה של כל אחת, והצלבה — הפרש הסגירה = סכום ההשפעות', () => {
    const C = F.oshChanges(ACC, { 'a:1': { sim: 1500 }, 'a:0': { desc: 'משכורת אוקטובר', date: '2026-10-04' }, 'b:0': { note: 'בדיקה' } }, [{ id: 'x', date: '2026-10-10', desc: 'מענק', amount: 500 }], -200)
    const by = (k: string) => C.list.find((x: any) => x.k === k)
    expect(by('a:1')).toMatchObject({ fields: ['כיוון'], before: -1500, after: 1500, delta: 3000 })
    expect(by('a:0')).toMatchObject({ fields: ['תאריך', 'שם'], delta: 0 }); expect(by('a:0').effect).toMatch(/לא את הסגירה/)
    expect(by('b:0')).toMatchObject({ fields: ['הערה'], delta: 0, effect: 'בלי השפעה על היתרה' })
    expect(by('opening')).toMatchObject({ before: 1000, after: -200, delta: -1200 })
    expect(by('add:x')).toMatchObject({ add: true, delta: 500 })
    expect(C.touched).toBe(4); expect(C.cross).toBe(true)
    expect(C.delta).toBe(3000 + 500 - 1200); expect(C.closingBefore).toBe(1500)
  })
})
describe('הלוגיקה וההצלבה', () => {
  it('תחשיב מיידי + זהות + יום ערך (שבת → ראשון) + תקופות מינוס עם ריבית + מסגרת', () => {
    expect(F.oshNextBiz('2026-10-03')).toBe('2026-10-04') // שבת → ראשון
    const M = F.oshMerge(ACC, {}, [{ id: 'y', date: '2026-10-02', desc: 'משיכה', amount: -2500 }], null) // יורד למינוס 2.10–7.10
    const L = F.oshLogic(M, ACC, { limit: 500, rate: 12 })
    const r = (k: string) => L.rules.find((x: any) => x.key === k)
    expect(r('chain').ok).toBe(true); expect(r('ident').ok).toBe(true)
    expect(L.periods.length).toBe(1)
    expect(L.periods[0]).toMatchObject({ start: '2026-10-04', min: -1000 }) // 2.10 = יום ו׳ → נכנס ביום א׳
    expect(L.periods[0].interest).toBeGreaterThan(0)
    expect(r('limit').ok).toBe(false); expect(r('od').warn).toBe(true)
    expect(r('internal').detail).toMatch(/2 תנועות פנימיות/)
    expect(r('source').detail).toMatch(/לאומי: 2\/2/)
  })
})
