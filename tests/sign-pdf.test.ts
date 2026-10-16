import { describe, expect, it } from 'vitest'
import {
  checkSignerValues, cleanField, fieldText, ilDate, initialsOf, mostActive, pdfRect, signersNeeded, validatePdfFields, validateUploads, visualOrder, type PdfField,
} from '@/lib/rules/sign-pdf.js'

const F = (o: Partial<PdfField>): PdfField => ({ id: 'f' + Math.random().toString(36).slice(2, 7), page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05, kind: 'signature', signer: 1, ...o })

describe('העלאה: PDF בלבד, עד 5 קבצים, עד 4MB', () => {
  it('קובץ שאינו PDF נדחה לפי התוכן, לא לפי השם', () => {
    expect(validateUploads([{ name: 'טופס.pdf', size: 100, head: 'PK\u0003\u0004' }])).toEqual(['"טופס.pdf" אינו PDF'])
    expect(validateUploads([{ name: 'a', size: 100, head: '%PDF-1.7' }])).toEqual([])
  })
  it('שישה קבצים / גדול מדי / כלום', () => {
    expect(validateUploads(Array(6).fill({ name: 'a.pdf', size: 1, head: '%PDF-1.4' }))).toContain('עד 5 קבצים בבת אחת')
    expect(validateUploads([{ name: 'a.pdf', size: 4_100_000, head: '%PDF-1.4' }])[0]).toMatch(/גדולים מדי/)
    expect(validateUploads([])).toEqual(['לא נבחר קובץ'])
  })
})

describe('שדות על המסמך', () => {
  it('cleanField: רק מפתחות מוכרים, סוג לא מוכר נדחה, required רק לטקסט/סימון', () => {
    expect(cleanField({ id: 'a', page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.04, kind: 'signature', signer: 1, required: true, evil: '<x>' })).toEqual({ id: 'a', page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.04, kind: 'signature', signer: 1 })
    expect(cleanField({ id: 'a', page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.04, kind: 'script', signer: 1 })).toBeNull()
    expect(cleanField({ id: 'b', page: 1, x: 0, y: 0, w: 0.1, h: 0.1, kind: 'text', signer: 2, required: true, label: ' מספר חשבון ' })).toMatchObject({ required: true, label: 'מספר חשבון' })
    expect(cleanField({ id: 'c', page: 0, x: '0.1', y: 0, w: 0.1, h: 0.1, kind: 'date', signer: 1 })).toBeNull()
  })
  it('לכל חותם חייב להיות שדה חתימה; עמוד/חותם/גבולות', () => {
    expect(validatePdfFields([], 1, 1)).toEqual(['לא הוצבו שדות על המסמך'])
    expect(validatePdfFields([F({ signer: 1 }), F({ kind: 'date', signer: 2 })], 1, 2)).toEqual(['ללווה 2 אין שדה חתימה'])
    expect(validatePdfFields([F({ page: 3 })], 2, 1)[0]).toMatch(/בעמוד 4 — במסמך 2 עמודים/)
    expect(validatePdfFields([F({ x: 0.9, w: 0.2 })], 1, 1)[0]).toMatch(/יוצא מגבולות העמוד/)
    expect(validatePdfFields([F({ signer: 3 })], 1, 2)).toContain('שדה של לווה 3 — במסמך 2 חותמים')
    expect(validatePdfFields([F({ signer: 1 }), F({ signer: 2 })], 1, 2)).toEqual([])
  })
  it('מספר החותמים = החותם הגבוה ביותר', () => {
    expect(signersNeeded([F({ signer: 1 }), F({ signer: 3 })])).toBe(3)
  })
  it('pdfRect: ראשית למטה — שדה בראש עמוד A4 מקבל y גבוה', () => {
    const r = pdfRect(F({ x: 0.5, y: 0, w: 0.25, h: 0.1 }), { w: 600, h: 800 })
    expect(r).toEqual({ x: 300, y: 720, w: 150, h: 80 })
  })
})

describe('מה שהחותם ממלא', () => {
  const fields = [F({ id: 'acc', kind: 'text', signer: 1, required: true, label: 'מספר חשבון' }), F({ id: 'ok', kind: 'checkbox', signer: 1, required: true, label: 'מאשר' }),
    F({ id: 'note', kind: 'text', signer: 1 }), F({ id: 'other', kind: 'text', signer: 2, required: true })]
  it('חובה חסרה → שגיאה; שדה של חותם אחר לא נבדק ולא נשמר', () => {
    expect(checkSignerValues(fields, 1, { other: 'x' }).errors).toEqual(['נא למלא: מספר חשבון', 'נא לסמן: מאשר'])
    const ok = checkSignerValues(fields, 1, { acc: ' 123 ', ok: true, other: 'גנוב' })
    expect(ok).toEqual({ values: { acc: '123', ok: '1' }, errors: [] })
  })
  it('fieldText: שם, ת"ז, תאריך בשעון ישראל, טקסט, סימון', () => {
    const s = { name: 'דנה כהן', idNumber: '012345674', signedAt: new Date('2026-10-14T22:30:00Z'), values: { acc: '123', ok: '1' } }
    expect(fieldText(F({ kind: 'name' }), s)).toBe('דנה כהן')
    expect(fieldText(F({ kind: 'date' }), s)).toBe('15/10/2026')
    expect(fieldText(F({ id: 'acc', kind: 'text' }), s)).toBe('123')
    expect(fieldText(F({ id: 'ok', kind: 'checkbox' }), s)).toBe('X')
    expect(fieldText(F({ id: 'zz', kind: 'checkbox' }), s)).toBe('')
  })
  it('ilDate / initialsOf', () => {
    expect(ilDate(new Date('2026-03-01T10:00:00Z'))).toBe('01/03/2026')
    expect(initialsOf('דנה  לוי כהן')).toBe('ד.ל.כ.')
  })
})

describe('עברית ב-PDF — סדר ויזואלי', () => {
  it('עברית מתהפכת, מספרים ולטינית נשארים, סוגריים מתחלפים', () => {
    expect(visualOrder('דנה כהן')).toBe('ןהכ הנד')
    expect(visualOrder('ת"ז 012345674')).toBe('012345674 ז"ת')
    expect(visualOrder('בנק (לאומי)')).toBe('(ימואל) קנב')
    expect(visualOrder('טל 03-5556677')).toBe('03-5556677 לט')
    expect(visualOrder('Dana Cohen 12/10')).toBe('Dana Cohen 12/10')
  })
})

describe('התבניות הכי פעילות', () => {
  it('לפי מספר שליחות בתקופה, בלי מסמכים מזדמנים', () => {
    const since = new Date('2026-07-01T00:00:00Z')
    const rows = [{ template_key: 'pdf:a', created_at: '2026-09-01' }, { template_key: 'pdf:a', created_at: '2026-10-01' }, { template_key: 'pdf:b', created_at: '2026-10-02' },
      { template_key: null, created_at: '2026-10-03' }, { template_key: 'pdf:c', created_at: '2026-01-01' }]
    expect(mostActive(rows, since)).toEqual([{ key: 'pdf:a', n: 2 }, { key: 'pdf:b', n: 1 }])
  })
})
