import { describe, expect, it } from 'vitest'
import { formTypeOf, FORM_TYPES } from '@/lib/rules/form-types.js'
import { checkSignerValues, senderFilled, type PdfField } from '@/lib/rules/sign-pdf.js'
import { curatedFor, parseCurated } from '@/lib/sign/curated.js'
import data from '@/data/sign-forms/curated.json'

describe('סוג הטופס מהשם (דן 21/10: "לשלוח לפי סוג התבנית")', () => {
  it.each([
    ['כתב הסמכה - טפחות (06.2026)', 'poa'],
    ['ייפוי כוח ליועץ משכנתאות והסכמה לנתוני אשראי - קרדיט 360', 'poa'],
    ['כתב הרשאה ליועץ - LOANWISE', 'poa'],
    ['כתב הסמכה באנגלית בנק טפחות - Letter of authorization of mortgage consultant', 'poa'],
    ['אישור תנאי שימוש וחיווי אשראי - קרדיטו', 'credit_check'],
    ['כלל - הודעה בנוגע לקבלת חיווי אשראי', 'credit_check'],
    ['מימון ישיר - לווה ראשון - טופס הסכמה לדוח נתוני אשראי עדכני 2024', 'credit_data'],
    ['הסכמת לקוח למשיכת דוח אשראי - לווה 1 - פמה משכנתאות', 'credit_data'],
    ['כתב ויתור סודיות מימון ישיר - לווה 3', 'privacy'],
    ['הראל - שאלון הכר את הלקוח - לווה 2', 'kyc'],
    ['טופס זיהוי פנים אל פנים - פמה משכנתאות', 'kyc'],
    ['כלל - בקשה לקבלת הלוואה', 'application'],
    ['איילון - בקשה לקבלת אישור עקרוני למשכנתא הפוכה', 'application'],
    ['קוואליטי IBI - טופס בקשה', 'application'],
    ['תצהיר הכנסות דיין - מגזר חרדי - בנק מזרחי טפחות', 'income'],
    ['אישור הכנסות בעל שליטה בנוסח בנק הפועלים', 'income'],
    ['תצהיר אחים ואחיות - זכאות - לווה 1', 'declaration'],
    ['הסכמת יזם תמא לרישום משכנתא בעיסקת רכישה - בנק לאומי', 'declaration'],
    ['איילון - רשימת שמאים', 'other'],
  ])('%s → %s', (name, t) => expect(formTypeOf(name)).toBe(t))
  it('כל סוג עם שם בעברית', () => { for (const v of Object.values(FORM_TYPES)) expect(v).toMatch(/[א-ת]/) })
})

describe('שדות מוכנים (data/sign-forms/curated.json)', () => {
  it('כל הטפסים בקובץ תקינים: שדות בגבולות העמוד, חתימה לכל לווה, סוג מוכר', () => {
    const r = parseCurated(data as never)
    expect(r.errors).toEqual([])
    expect(r.forms.length).toBe((data as { forms: unknown[] }).forms.length)
  })
  it('אין שתי רשומות לאותו קובץ', () => {
    const shas = (data as { forms: { sha256: string }[] }).forms.map((f) => f.sha256)
    expect(new Set(shas).size).toBe(shas.length)
  })
  it('טופס עם שדה מחוץ לעמוד או בלי חתימה ללווה 2 — לא נכנס, עם הסבר', () => {
    const sha = 'a'.repeat(64)
    const r = parseCurated({ forms: [
      { sha256: sha, name: 'א', folder: 'גוף', type: 'poa', category: 'poa', pages: 1, fields: [{ page: 0, kind: 'signature', signer: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, { page: 0, kind: 'name', signer: 2, x: 0.1, y: 0.2, w: 0.2, h: 0.03 }] },
      { sha256: 'b'.repeat(64), name: 'ב', folder: 'גוף', type: 'poa', category: 'poa', pages: 1, fields: [{ page: 1, kind: 'signature', signer: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] },
    ] })
    expect(r.forms).toEqual([])
    expect(r.errors[0]).toMatch(/ללווה 2 אין שדה חתימה/)
    expect(r.errors[1]).toMatch(/בעמוד 2/)
  })
  it('מזהי השדות יציבים (c1, c2…) — אותו טופס תמיד עם אותם מזהים', () => {
    const r = parseCurated({ forms: [{ sha256: 'c'.repeat(64), name: 'א', folder: 'גוף', type: 'kyc', category: 'bank', pages: 1, fields: [{ page: 0, kind: 'signature', signer: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, { page: 0, kind: 'date', signer: 1, x: 0.4, y: 0.1, w: 0.1, h: 0.03 }] }] })
    expect(r.forms[0]!.fields.map((f) => f.id)).toEqual(['c1', 'c2'])
    expect(r.forms[0]!.signers).toBe(1)
  })
  it('טביעה לא מוכרת → אין שדות מוכנים', () => { expect(curatedFor('0'.repeat(64))).toBeNull(); expect(curatedFor('')).toBeNull() })
})

describe('פרטי היועץ בטופס — השולח ממלא, החותם לא משנה', () => {
  const fields: PdfField[] = [
    { id: 'a', page: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.03, kind: 'text', signer: 1, src: 'advisor_name', label: 'שם היועץ' },
    { id: 'b', page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.03, kind: 'text', signer: 1, src: 'signer_phone', label: 'טלפון' },
  ]
  it('senderFilled: הערות ופרטי היועץ בלבד', () => {
    expect(senderFilled('notes')).toBe(true); expect(senderFilled('advisor_id')).toBe(true)
    expect(senderFilled('signer_phone')).toBe(false); expect(senderFilled(undefined)).toBe(false)
  })
  it('ערך שהדפדפן שלח לשדה היועץ — מוחלף במה שהשולח מילא', () => {
    const r = checkSignerValues(fields, 1, { a: 'מישהו אחר', b: '0501234567' }, '', { a: 'הר-אל פתרונות מימון' })
    expect(r.values).toEqual({ a: 'הר-אל פתרונות מימון', b: '0501234567' })
  })
  it('השולח לא מילא — השדה נשאר ריק, ולא נלקח מהחותם', () => {
    expect(checkSignerValues(fields, 1, { a: 'זיוף' }).values).toEqual({})
  })
})

describe('טופס לשני לווים — נשלח ללווה אחד', () => {
  it('השדות של לווה 2 יורדים, של לווה 1 נשארים', async () => {
    const { fieldsForSigners, validatePdfFields } = await import('@/lib/rules/sign-pdf.js')
    const f = (signer: number, kind: PdfField['kind']): PdfField => ({ id: kind + signer, page: 0, x: 0.1, y: 0.1 * signer, w: 0.2, h: 0.03, kind, signer })
    const all = [f(1, 'name'), f(1, 'signature'), f(2, 'name'), f(2, 'signature')]
    const one = fieldsForSigners(all, 1)
    expect(one.map((x) => x.id)).toEqual(['name1', 'signature1'])
    expect(validatePdfFields(one, 1, 1)).toEqual([])
    expect(fieldsForSigners(all, 2)).toHaveLength(4)
    expect(fieldsForSigners(all, 0).map((x) => x.signer)).toEqual([1, 1])
  })
})
