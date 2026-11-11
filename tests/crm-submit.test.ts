import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** סדר הגשה לכל גוף (דן 09/11) — אותו קוד שרץ במסך (crm/harel-crm.html). נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ סדר הגשה לכל גוף'), b = html.indexOf('/* ══ סוף סדר הגשה — פונקציות טהורות ══ */')
const fa = html.indexOf('const YN = '), fb = html.indexOf('/* ══ סוף רשימת הגופים')
const F = new Function(html.slice(a, b) + html.slice(fa, fb) + '; return { subAddr, subPick, subValue, subDate, subSenBand, subKey, subCur, subScanProposals, subDocMatch, SUBMIT_FLOWS: typeof SUBMIT_FLOWS_ALL !== "undefined" ? SUBMIT_FLOWS_ALL : SUBMIT_FLOWS };')() as any

describe('כתובת → שדות בטופס', () => {
  it('רחוב ומספר, עיר, דירה, מיקוד', () => {
    expect(F.subAddr('הרצל 12 דירה 4, רמת גן 5250000')).toEqual({ street: 'הרצל', house: '12', apt: '4', city: 'רמת גן', zip: '5250000' })
    expect(F.subAddr('שדרות בן גוריון 3א, תל אביב')).toMatchObject({ street: 'שדרות בן גוריון', house: '3א', city: 'תל אביב' })
    expect(F.subAddr('נתניה')).toMatchObject({ city: 'נתניה', street: '' })
    expect(F.subAddr('')).toEqual({})
  })
  it('תאריך YYYY-MM-DD → DD/MM/YYYY', () => { expect(F.subDate('1985-03-07')).toBe('07/03/1985') })
})

describe('ערך → אחת מהאפשרויות בטופס', () => {
  it('זהה / בלי גרשיים / מכיל; לא נמצא — מסומן לבדיקה', () => {
    expect(F.subPick('שכיר', ['שכיר', 'עצמאי'])).toEqual({ v: 'שכיר', ok: true })
    expect(F.subPick('חל"ת', ['חל״ת', 'חל״ד'])).toEqual({ v: 'חל״ת', ok: true })
    expect(F.subPick('דירה', ['דירה בבניין מגורים'])).toEqual({ v: 'דירה בבניין מגורים', ok: true })
    expect(F.subPick('יאכטה', ['דירה'])).toEqual({ v: 'יאכטה', ok: false })
  })
})

describe('שדה לפי מקור', () => {
  const D = { b: [{ first: 'דנה', last: 'כהן-לוי', emp: 'salaried', income: 12000 }, { first: 'Avi', emp: 'self' }], req: { purpose: 'consolidation', amount: 400000 }, credit: { execution: false }, prop: {}, fixed: { no: false } }
  const fr = F.SUBMIT_FLOWS.find((f: any) => f.key === 'frisbee'), field = (st: number, l: string) => fr.steps[st].f.find((f: any) => f.l === l)
  it('פריסבי: מטרה ותעסוקה מתורגמות לאפשרויות של פריסבי; כל לווה בשלב שחוזר', () => {
    expect(F.subValue(field(0, 'מטרת אשראי'), D)).toMatchObject({ v: 'מיחזור לאיחוד חובות', kind: 'ok' })
    expect(F.subValue(field(2, 'סוג העסקה'), D, 0)).toMatchObject({ v: 'שכיר', kind: 'ok' })
    expect(F.subValue(field(2, 'סוג העסקה'), D, 1)).toMatchObject({ v: 'עצמאי', kind: 'ok' })
    expect(F.subValue(field(2, 'שם פרטי'), D, 1)).toMatchObject({ v: 'Avi', kind: 'ok' })
  })
  it('כן/לא, חסר, להזין בטופס, מסמך', () => {
    expect(F.subValue({ l: 'הוצל״פ', s: 'credit.execution', o: ['כן', 'לא'] }, D)).toMatchObject({ v: 'לא', kind: 'ok' })
    expect(F.subValue({ l: 'שווי', s: 'prop.value' }, D)).toMatchObject({ v: '', kind: 'missing' })
    expect(F.subValue({ l: 'מגדר', t: 'manual' }, D).kind).toBe('manual')
    expect(F.subValue({ l: 'ת״ז', t: 'upload' }, D).kind).toBe('upload')
  })
  it('כל גוף: לכל שדה שם, ולכל מקור — קבוצה מוכרת', () => {
    const groups = new Set(['b', 'bx', 'x', 'req', 'prop', 'obl', 'credit', 'biz', 'adv', 'fixed'])
    for (const fl of F.SUBMIT_FLOWS) for (const st of fl.steps) for (const f of st.f) { expect(f.l).toBeTruthy(); if (f.s) expect(groups.has(f.s.split('.')[0]), fl.key + ': ' + f.s).toBe(true) }
  })
})

describe('גופים מ-WISE: מזרחי-טפחות, מימון ישיר, פמה', () => {
  const fl = (k: string) => F.SUBMIT_FLOWS.find((f: any) => f.key === k), fld = (k: string, l: string) => fl(k).steps.flatMap((s: any) => s.f).find((f: any) => f.l === l)
  const D = { b: [{ seniority: 6, senBand: F.subSenBand(6), emp: 'salaried' }], req: { purpose: 'refinance', nBorrowers: '2', months: 240 }, prop: { isHome: true, lienRank: 'שנייה' }, fixed: {} }
  it('כל שישה הגופים ברשימה, ומפתח ייחודי לכל אחד', () => {
    const keys = F.SUBMIT_FLOWS.map((f: any) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['ogen', 'credit360', 'frisbee', 'mizrahi', 'mimun', 'pama']))
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('ותק → טווח של מזרחי', () => {
    expect([F.subSenBand(0.5), F.subSenBand(2), F.subSenBand(3), F.subSenBand(6), F.subSenBand('')]).toEqual(['עד שנה', 'שנה עד 3 שנים', 'שנה עד 3 שנים', 'מעל 3 שנים', ''])
  })
  it('מזרחי: מחזור → "מחזור משכנתא"; דירה יחידה; ותק; מספר מבקשים', () => {
    expect(F.subValue(fld('mizrahi', 'סוג הבקשה'), D)).toMatchObject({ v: 'מחזור משכנתא', kind: 'ok' })
    expect(F.subValue(fld('mizrahi', 'האם זו הדירה היחידה של המבקשים?'), D)).toMatchObject({ v: 'כן, דירה יחידה', kind: 'ok' })
    expect(F.subValue(fld('mizrahi', 'ותק אצל המעסיק'), D, 0)).toMatchObject({ v: 'מעל 3 שנים', kind: 'ok' })
    expect(F.subValue(fld('mizrahi', 'מספר מבקשי המשכנתא'), D)).toMatchObject({ v: '2', kind: 'ok' })
  })
  it('פמה ומימון ישיר: מטרה, דרגת שעבוד, פריסה בחודשים', () => {
    expect(F.subValue(fld('pama', 'מהי מטרת הבקשה?'), D)).toMatchObject({ v: 'מחזור משכנתא', kind: 'ok' })
    expect(F.subValue(fld('pama', 'מה סוג השעבוד?'), D).v).toBe('שעבוד דרגה שנייה')
    expect(F.subValue(fld('pama', 'פריסה בחודשים'), D).v).toBe(240)
    expect(F.subValue(fld('mimun', 'מה סוג העסקה?'), D).v).toBe('משכנתא לכל מטרה')
  })
})

describe('הזנה ועריכה (דן 11/11): ערך שהוזן נשמר פעם אחת ומשמש את כל הגופים', () => {
  const fl = (k: string) => F.SUBMIT_FLOWS.find((f: any) => f.key === k), fld = (k: string, l: string) => fl(k).steps.flatMap((s: any) => s.f).find((f: any) => f.l === l)
  it('מפתח: ערך גולמי משותף; עם תרגום / קבוע / בלי מקור — לפי גוף; שדה לווה — לכל לווה', () => {
    expect(F.subKey({ l: 'מגדר', s: 'bx.gender', t: 'manual' }, 'frisbee', 1)).toBe('bx.gender#1')
    expect(F.subKey({ l: 'סכום', s: 'req.amount' }, 'pama', 0)).toBe('req.amount')
    expect(F.subKey({ l: 'מטרה', s: 'req.purpose', m: { a: 'b' } }, 'pama', 0)).toBe('m:pama:מטרה#0')
    expect(F.subKey({ l: 'תושב חוץ?', s: 'fixed.no' }, 'frisbee', 1)).toBe('m:frisbee:תושב חוץ?#1')
    expect(F.subKey({ l: 'זיהיתי', t: 'manual' }, 'mimun', 0)).toBe('m:mimun:זיהיתי#0')
  })
  it('מגדר שהוזן פעם אחת מופיע בפריסבי, מימון ישיר ופמה; ערך שנערך גובר על התיק', () => {
    const D = { b: [{ income: 9000 }], ov: { 'bx.gender#0': 'נקבה', 'b.income#0': '9500' }, req: {}, prop: {}, fixed: {} }
    for (const [k, l] of [['frisbee', 'מגדר'], ['mimun', 'מין'], ['pama', 'מין']] as [string, string][]) expect(F.subValue(fld(k, l), D, 0, k)).toMatchObject({ v: 'נקבה', kind: 'ok', ed: true })
    expect(F.subValue(fld('mimun', 'משכורת חודשית נטו'), D, 0, 'mimun')).toMatchObject({ v: '9500', ed: true })
    expect(F.subValue(fld('mimun', 'מין'), { ...D, ov: {} }, 0, 'mimun').kind).toBe('manual')
  })
  it('שדה שכל הגופים צריכים — מוגדר אצל כולם עם אותו מקור (מצב משפחתי, מעסיק, חשבון בנק)', () => {
    expect(fld('frisbee', 'מצב משפחתי').s).toBe('bx.marital'); expect(fld('mizrahi', 'מצב משפחתי').s).toBe('bx.marital')
    expect(fld('mimun', 'מקום העבודה').s).toBe('bx.employer'); expect(fld('frisbee', 'שם מעסיק').s).toBe('bx.employer')
    expect(fld('frisbee', 'חשבון לחיוב — מספר חשבון').s).toBe('bx.bankAcct'); expect(fld('pama', 'מספר חשבון').s).toBe('bx.bankAcct')
  })
})

describe('✨ מילוי מהמסמכים — הצעה בלבד', () => {
  const D = { b: [{ full: 'דנה כהן-לוי', id: '000000018', birth: '07/03/1985', income: 14000 }, { full: 'Avi Levi', id: '000000026' }], ov: { 'bx.employer#1': 'חברה בע״מ' }, prop: {}, x: {} }
  it('ת״ז של הלווה השני → השדות שלו; ערך זהה לתיק לא מוצע', () => {
    const P = F.subScanProposals({ person: { name: 'Avi Levi', id: '26' }, gender: 'זכר', idIssue: '01/02/2015', birth: '' }, D, 'תז אבי.pdf')
    expect(P.map((p: any) => p.key)).toEqual(['bx.gender#1', 'bx.idIssue#1'])
    expect(P[0]).toMatchObject({ v: 'זכר', cur: '', src: 'תז אבי.pdf' })
  })
  it('תלוש: מעסיק שונה מהשמור — מוצע עם הערך הנוכחי; נטו זהה — לא', () => {
    const P = F.subScanProposals({ person: { name: 'Avi Levi' }, employer: 'אחרת בע״מ', netIncome: '' }, D, 'תלוש.pdf')
    expect(P).toEqual([expect.objectContaining({ key: 'bx.employer#1', cur: 'חברה בע״מ', v: 'אחרת בע״מ' })])
    expect(F.subScanProposals({ person: { id: '18' }, netIncome: '14,000', bankAcct: '123456' }, D, 'x').map((p: any) => p.key)).toEqual(['bx.bankAcct#0'])
  })
  it('לא מזוהה — לווה 1; תשובה ריקה — כלום', () => {
    expect(F.subScanProposals({ person: {}, gush: '6158' }, D, 'נסח.pdf')[0]).toMatchObject({ key: 'prop.gush', v: '6158' })
    expect(F.subScanProposals(null, D, '')).toEqual([])
  })
})

describe('📎 מסמכים שהגוף מבקש ↔ קבצים בתיק', () => {
  const files = [{ id: '1', title: 'ת״ז דנה.pdf' }, { id: '2', title: 'ספח.jpg' }, { id: '3', title: 'תלוש 10-2026.pdf' }, { id: '4', title: 'כתב הסמכה חתום.pdf' }, { id: '5', title: 'BDI.pdf' }]
  it('לפי שם המסמך בטופס', () => {
    expect(F.subDocMatch('ת״ז + ספח — לכל לווה', files).map((f: any) => f.id)).toEqual(['1', '2'])
    expect(F.subDocMatch('כתב הסמכה ליועץ (לווים 1 ו-2)', files).map((f: any) => f.id)).toEqual(['4'])
    expect(F.subDocMatch('כתב הסמכה לדוח מלא (נתוני אשראי) — לכל לווה', files).map((f: any) => f.id)).toContain('5')
    expect(F.subDocMatch('משהו אחר', files)).toEqual([])
  })
})
