import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** סדר הגשה לכל גוף (דן 09/11) — אותו קוד שרץ במסך (crm/harel-crm.html). נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ סדר הגשה לכל גוף'), b = html.indexOf('/* ══ סוף סדר הגשה — פונקציות טהורות ══ */')
const fa = html.indexOf('const YN = '), fb = html.indexOf('/* ══ סוף רשימת הגופים')
const F = new Function(html.slice(a, b) + html.slice(fa, fb) + '; return { subAddr, subPick, subValue, subDate, subSenBand, SUBMIT_FLOWS: typeof SUBMIT_FLOWS_ALL !== "undefined" ? SUBMIT_FLOWS_ALL : SUBMIT_FLOWS };')() as any

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
    expect(F.subValue(field(0, 'מטרת אשראי'), D)).toEqual({ v: 'מיחזור לאיחוד חובות', kind: 'ok' })
    expect(F.subValue(field(2, 'סוג העסקה'), D, 0)).toEqual({ v: 'שכיר', kind: 'ok' })
    expect(F.subValue(field(2, 'סוג העסקה'), D, 1)).toEqual({ v: 'עצמאי', kind: 'ok' })
    expect(F.subValue(field(2, 'שם פרטי'), D, 1)).toEqual({ v: 'Avi', kind: 'ok' })
  })
  it('כן/לא, חסר, להזין בטופס, מסמך', () => {
    expect(F.subValue({ l: 'הוצל״פ', s: 'credit.execution', o: ['כן', 'לא'] }, D)).toEqual({ v: 'לא', kind: 'ok' })
    expect(F.subValue({ l: 'שווי', s: 'prop.value' }, D)).toEqual({ v: '', kind: 'missing' })
    expect(F.subValue({ l: 'מגדר', t: 'manual' }, D).kind).toBe('manual')
    expect(F.subValue({ l: 'ת״ז', t: 'upload' }, D).kind).toBe('upload')
  })
  it('כל גוף: לכל שדה שם, ולכל מקור — קבוצה מוכרת', () => {
    const groups = new Set(['b', 'req', 'prop', 'obl', 'credit', 'biz', 'adv', 'fixed'])
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
    expect(F.subValue(fld('mizrahi', 'סוג הבקשה'), D)).toEqual({ v: 'מחזור משכנתא', kind: 'ok' })
    expect(F.subValue(fld('mizrahi', 'האם זו הדירה היחידה של המבקשים?'), D)).toEqual({ v: 'כן, דירה יחידה', kind: 'ok' })
    expect(F.subValue(fld('mizrahi', 'ותק אצל המעסיק'), D, 0)).toEqual({ v: 'מעל 3 שנים', kind: 'ok' })
    expect(F.subValue(fld('mizrahi', 'מספר מבקשי המשכנתא'), D)).toEqual({ v: '2', kind: 'ok' })
  })
  it('פמה ומימון ישיר: מטרה, דרגת שעבוד, פריסה בחודשים', () => {
    expect(F.subValue(fld('pama', 'מהי מטרת הבקשה?'), D)).toEqual({ v: 'מחזור משכנתא', kind: 'ok' })
    expect(F.subValue(fld('pama', 'מה סוג השעבוד?'), D).v).toBe('שעבוד דרגה שנייה')
    expect(F.subValue(fld('pama', 'פריסה בחודשים'), D).v).toBe(240)
    expect(F.subValue(fld('mimun', 'מה סוג העסקה?'), D).v).toBe('משכנתא לכל מטרה')
  })
})
