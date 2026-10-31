import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import {
  cleanApply, detectBlanks, editedName, fallbackFile, fileOfKey, fitText, fontStyle, groupSpans, kindFromLabel, labelFor, toUnicodeCMap, underscoreRuns,
  type PdfChar, type Span,
} from '../lib/rules/pdf-edit'
import { fontkitRuns, visualOrder } from '../lib/rules/sign-pdf'
import { stampPdf } from '../lib/sign/pdf'
import { analyzePdf, applyPdf, type Analysis } from '../lib/pdfedit/engine'

const ch = (c: string, x: number, line = 0, o: Partial<PdfChar> = {}): PdfChar => ({ c, rect: [x, 100, x + 6, 112], origin: [x, 110], font: 'ABCDEF+ArialMT', size: 11, color: [0, 0, 0], line, ...o })
const span = (text: string, rect: [number, number, number, number], o: Partial<Span> = {}): Span => ({ id: 0, text, rect, baseline: rect[3] - 2, font: 'ArialMT', size: 10, color: '#000000', bold: false, italic: false, family: 'sans', rtl: /[א-ת]/.test(text), ...o })

describe('fontStyle / גופן חלופי', () => {
  it('מזהה משפחה, מודגש ונטוי משם הגופן (כולל קידומת subset)', () => {
    expect(fontStyle('ABCDEF+Arial-BoldMT')).toEqual({ family: 'sans', bold: true, italic: false })
    expect(fontStyle('TimesNewRomanPS-ItalicMT')).toEqual({ family: 'serif', bold: false, italic: true })
    expect(fontStyle('CourierNewPSMT').family).toBe('mono')
    expect(fontStyle('David-Bold')).toEqual({ family: 'serif', bold: true, italic: false })
    expect(fontStyle('NotoSans-Regular').family).toBe('sans')
  })
  it('קובץ Liberation לפי הסגנון; מפתח לא מוכר = null (לא נתיב חופשי)', () => {
    expect(fallbackFile({ family: 'serif', bold: true, italic: true })).toBe('LiberationSerif-BoldItalic.ttf')
    expect(fileOfKey('sans-bold')).toBe('LiberationSans-Bold.ttf')
    expect(fileOfKey('mono')).toBe('LiberationMono-Regular.ttf')
    expect(fileOfKey('../../etc/passwd')).toBeNull()
  })
})

describe('groupSpans', () => {
  it('עברית: התווים על העמוד (משמאל לימין) → טקסט לוגי; תיבה בלי רווחים בקצוות', () => {
    const vis = visualOrder('שם: ישראל')
    const chars = [...vis].map((c, i) => ch(c, 200 + i * 6))
    chars.push(ch(' ', 200 + vis.length * 6))
    const s = groupSpans(chars)[0]!
    expect(s.text).toBe('שם: ישראל')
    expect(s.rtl).toBe(true)
    expect(s.rect[0]).toBe(200); expect(s.rect[2]).toBe(200 + vis.length * 6)
  })
  it('מפצל בשינוי סגנון ובפער גדול; תווים בסדר לא ממוין מתאחדים לפי x', () => {
    const a = [ch('A', 10), ch('B', 16), ch('C', 22, 0, { font: 'Arial-BoldMT' }), ch('D', 80)]
    const sp = groupSpans(a.reverse())
    expect(sp.map((s) => s.text)).toEqual(['AB', 'C', 'D'])
    expect(sp[1]!.bold).toBe(true)
  })
  it('שורות נפרדות = spans נפרדים', () => {
    expect(groupSpans([ch('A', 10, 0), ch('B', 16, 1)]).length).toBe(2)
  })
})

describe('שדות ריקים', () => {
  it('רצף ____ ו-...... בשורה', () => {
    const r = underscoreRuns([...'שם'].map((c, i) => ch(c, 300 + i * 6)).concat([...'_____'].map((c, i) => ch(c, 200 + i * 6)), [...'......'].map((c, i) => ch(c, 100 + i * 4))))
    expect(r.length).toBe(2)
    expect(underscoreRuns([...'___'].map((c, i) => ch(c, 10 + i * 6))).length).toBe(0)
  })
  it('קו מתחת לתווית "תאריך:" → שדה תאריך; קו שיש עליו טקסט / קו מפריד — לא', () => {
    const spans = [span('תאריך:', [400, 90, 440, 102]), span('כבר מולא', [100, 140, 180, 152])]
    const out = detectBlanks(0, 595, [
      { kind: 'S', rect: [250, 101.6, 395, 102.4] },      // קו ריק ליד התווית
      { kind: 'S', rect: [95, 152.5, 200, 153] },         // קו שהטקסט יושב עליו
      { kind: 'S', rect: [20, 300, 575, 300.5] },          // קו מפריד לכל הרוחב
    ], spans, [])
    expect(out.length).toBe(1)
    expect(out[0]!).toMatchObject({ kind: 'date', label: 'תאריך', from: 'line' })
    expect(out[0]!.rect[3]).toBeCloseTo(101.6)
  })
  it('ריבוע קטן = סימון; 9 תיבות צמודות = משבצות ת״ז (שדה אחד)', () => {
    const vecs = [{ kind: 'S' as const, rect: [500, 200, 510, 210] as [number, number, number, number] }]
    for (let i = 0; i < 9; i++) vecs.push({ kind: 'S', rect: [100 + i * 14, 250, 114 + i * 14, 268] })
    const out = detectBlanks(0, 595, vecs, [span('מספר זהות', [240, 252, 290, 264])], [])
    expect(out.find((b) => b.kind === 'checkbox')).toBeTruthy()
    const comb = out.find((b) => b.kind === 'comb')!
    expect(comb.cells).toBe(9); expect(comb.label).toBe('מספר זהות')
  })
  it('תווית: מימין בעברית, אחרת משמאל, אחרת מעל', () => {
    const f: [number, number, number, number] = [200, 100, 300, 112]
    expect(labelFor(f, [span('שם הלווה:', [310, 100, 360, 112]), span('Name', [150, 100, 190, 112], { rtl: false })])).toBe('שם הלווה')
    expect(labelFor(f, [span('Account', [140, 100, 190, 112], { rtl: false })])).toBe('Account')
    expect(labelFor(f, [span('כתובת', [220, 85, 260, 97])])).toBe('כתובת')
    expect(kindFromLabel('חתימת הלווה')).toBe('signature'); expect(kindFromLabel('ת.ז')).toBe('id_number'); expect(kindFromLabel('שם מלא')).toBe('name'); expect(kindFromLabel('כתובת')).toBeNull()
  })
})

describe('fitText / ToUnicode / שם קובץ', () => {
  it('נכנס — בלי שינוי; קצת ארוך — דחיסה; הרבה — גם גודל', () => {
    expect(fitText(50, 60, 11)).toEqual({ size: 11, scale: 1 })
    expect(fitText(100, 90, 11)).toEqual({ size: 11, scale: 0.9 })
    const f = fitText(200, 80, 11); expect(f.scale).toBe(0.8); expect(f.size).toBeCloseTo(5.5, 1)
    expect(fitText(1000, 10, 11).size).toBe(5)
  })
  it('CMap: gid → unicode, כולל תו מחוץ ל-BMP', () => {
    const m = toUnicodeCMap([[5, 0x05d0], [7, 0x1f600], [5, 0x41]])
    expect(m).toContain('<0005> <05D0>'); expect(m).toContain('<0007> <D83DDE00>'); expect(m).not.toContain('<0005> <0041>')
  })
  it('editedName', () => {
    expect(editedName('טופס בנק.pdf')).toBe('טופס בנק (ערוך).pdf')
    expect(editedName('טופס בנק (ערוך).pdf')).toBe('טופס בנק (ערוך).pdf')
  })
})

describe('cleanApply', () => {
  it('מקבל בקשה תקינה ומנקה', () => {
    const { req, errors } = cleanApply({ edits: [{ page: 0, span: 3, text: 'א\nב' }], erase: [{ page: 1, rect: [1, 2, 3, 4] }], adds: [{ page: 0, kind: 'text', rect: [0, 0, 50, 20], text: 'שלום', color: '#112233' }, { page: 0, kind: 'text', rect: [0, 0, 50, 20], text: '  ' }], pages: { rotate: { 1: 450 }, order: [1, 0] }, form: { a: 'x', b: true, c: 5 }, flatten: true }, 2)
    expect(errors).toEqual([])
    expect(req.edits[0]!.text).toBe('א ב')
    expect(req.adds.length).toBe(1)
    expect(req.pages).toEqual({ rotate: { 1: 90 }, order: [1, 0] })
    expect(req.form).toEqual({ a: 'x', b: true })
  })
  it('דוחה עמוד לא קיים, צבע/תמונה לא תקינים, סיבוב לא ישר, סדר עם כפילות', () => {
    const { errors } = cleanApply({ edits: [{ page: 5, span: 0, text: 'x' }], adds: [{ page: 0, kind: 'image', rect: [0, 0, 1, 1], image: 'data:text/html;base64,AAAA' }, { page: 0, kind: 'check', rect: [0, 0, 1, 1], color: 'red' }], pages: { rotate: { 0: 45 }, order: [0, 0] } }, 2)
    expect(errors.length).toBe(5)
  })
})

/* ── המנוע על טופס סינתטי (עברית + אנגלית, קו ריק, סימון, משבצות, טופס AcroForm) ── */
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** עברית דרך pdf-lib — כמו stampPdf (fontkit הופך מחרוזת עברית בעצמו) */
const drawHe = (p: PDFPage, f: PDFFont, t: string, x: number, y: number, size: number) => { for (const r of fontkitRuns(t)) { p.drawText(r, { x, y, size, font: f }); x += f.widthOfTextAtSize(r, size) } }
let form: Uint8Array
let A: Analysis
const sansFile = 'assets/fonts/liberation/LiberationSans-Regular.ttf'

beforeAll(async () => {
  const d = await PDFDocument.create(); d.registerFontkit(fontkit)
  const he = await d.embedFont(readFileSync(sansFile), { subset: true })
  const hv = await d.embedFont(StandardFonts.Helvetica)
  const p = d.addPage([595, 842])
  drawHe(p, he, 'שם הלווה: ישראל ישראלי', 330, 760, 12)
  p.drawText('Account No. 12345', { x: 60, y: 720, size: 11, font: hv, color: rgb(0.1, 0.2, 0.6) })
  drawHe(p, he, 'תאריך:', 500, 680, 11)
  p.drawLine({ start: { x: 330, y: 678 }, end: { x: 490, y: 678 }, thickness: 0.7 })
  p.drawRectangle({ x: 500, y: 640, width: 10, height: 10, borderWidth: 0.8, borderColor: rgb(0, 0, 0) })
  drawHe(p, he, 'מאשר/ת', 455, 641, 11)
  for (let i = 0; i < 9; i++) p.drawRectangle({ x: 200 + i * 14, y: 590, width: 14, height: 18, borderWidth: 0.6, borderColor: rgb(0, 0, 0) })
  drawHe(p, he, 'מספר זהות', 340, 594, 11)
  drawHe(p, he, 'סוד שצריך למחוק', 60, 500, 11)
  const f = d.getForm()
  const t = f.createTextField('borrower'); t.addToPage(d.addPage([595, 842]), { x: 300, y: 700, width: 200, height: 20 })
  const c = f.createCheckBox('agree'); c.addToPage(d.getPage(1), { x: 300, y: 650, width: 12, height: 12 })
  form = await d.save()
  A = await analyzePdf(form)
}, 30000)

const findSpan = (a: Analysis, pg: number, needle: string) => a.pages[pg]!.spans.find((s) => s.text.includes(needle))!

describe('analyzePdf', () => {
  it('spans עם טקסט לוגי, פונט, גודל, צבע', () => {
    const name = findSpan(A, 0, 'ישראלי')
    expect(name.text).toBe('שם הלווה: ישראל ישראלי')
    expect(name.size).toBeCloseTo(12); expect(name.rtl).toBe(true)
    const acc = findSpan(A, 0, 'Account')
    expect(acc.color).toBe('#1a3399'); expect(acc.family).toBe('sans')
  })
  it('שדות ריקים: קו ליד "תאריך", סימון ליד "מאשר/ת", משבצות ת״ז', () => {
    const b = A.pages[0]!.blanks
    expect(b.find((x) => x.kind === 'date' && x.label === 'תאריך')).toBeTruthy()
    expect(b.find((x) => x.kind === 'checkbox')?.label).toBe('מאשר/ת')
    expect(b.find((x) => x.kind === 'comb')).toMatchObject({ cells: 9, label: 'מספר זהות' })
  })
  it('שדות AcroForm', () => {
    expect(A.pages[1]!.widgets.map((w) => w.name).sort()).toEqual(['agree', 'borrower'])
    expect(A.pages[0]!.scanned).toBe(false)
  })
})

describe('applyPdf', () => {
  it('עריכה בגופן המקורי (ספרות קיימות) + עברית חדשה (Liberation) — הישן נמחק מהקובץ, החדש בר-חיפוש', async () => {
    const acc = findSpan(A, 0, 'Account'), name = findSpan(A, 0, 'ישראלי')
    const r = await applyPdf(form, cleanApply({ edits: [{ page: 0, span: acc.id, text: 'Account No. 54321' }, { page: 0, span: name.id, text: 'שם הלווה: משה כהן' }] }, 2).req)
    const B = await analyzePdf(r.bytes)
    expect(r.checks).toMatchObject({ edits: 2, verified: 2, warnings: [] })
    const all = B.pages[0]!.spans.map((s) => s.text).join(' | ')
    expect(all).toContain('54321'); expect(all).not.toContain('12345')
    expect(all).toContain('משה כהן'); expect(all).not.toContain('ישראלי')
    const acc2 = findSpan(B, 0, '54321')
    expect(acc2.color).toBe('#1a3399'); expect(acc2.size).toBeCloseTo(11, 0)
    expect(Math.abs(acc2.baseline - acc.baseline)).toBeLessThan(0.6)
    // עברית מיושרת לקצה הימני של הישן
    const name2 = findSpan(B, 0, 'משה')
    expect(Math.abs(name2.rect[2] - name.rect[2])).toBeLessThan(1.5)
  }, 30000)
  it('מחיקת אזור מוחקת את הטקסט בתוכו בלבד', async () => {
    const sec = findSpan(A, 0, 'סוד')
    const r = await applyPdf(form, cleanApply({ erase: [{ page: 0, rect: [sec.rect[0] - 2, sec.rect[1] - 2, sec.rect[2] + 2, sec.rect[3] + 2] }] }, 2).req)
    const all = (await analyzePdf(r.bytes)).pages[0]!.spans.map((s) => s.text).join(' ')
    expect(all).not.toContain('סוד'); expect(all).toContain('Account No. 12345')
  }, 30000)
  it('תוספות: טקסט בעברית, ✓, ✗, תמונה, סימון, ציור', async () => {
    const r = await applyPdf(form, cleanApply({ adds: [
      { page: 0, kind: 'text', rect: [100, 300, 300, 330], text: 'הערה: Bank Hapoalim 12' },
      { page: 0, kind: 'date', rect: [330, 150, 490, 165], text: '31/10/2026', size: 10 },
      { page: 0, kind: 'check', rect: [500, 192, 510, 202] }, { page: 0, kind: 'cross', rect: [100, 400, 112, 412] },
      { page: 0, kind: 'image', rect: [60, 600, 160, 640], image: PNG_1PX },
      { page: 0, kind: 'highlight', rect: [60, 120, 160, 134] },
      { page: 0, kind: 'draw', rect: [0, 0, 1, 1], points: [[[10, 10], [40, 30], [80, 12]]] },
    ] }, 2).req)
    const all = (await analyzePdf(r.bytes)).pages[0]!.spans.map((s) => s.text).join(' | ')
    expect(all).toContain('הערה: Bank Hapoalim 12'); expect(all).toContain('31/10/2026')
  }, 30000)
  it('טופס: מילוי בעברית + שיטוח (השדות יורדים, הערכים נשארים כטקסט)', async () => {
    const r = await applyPdf(form, cleanApply({ form: { borrower: 'דנה לוי', agree: true }, flatten: true }, 2).req)
    const B = await analyzePdf(r.bytes)
    expect(B.pages[1]!.widgets).toEqual([])
    expect(B.pages[1]!.spans.map((s) => s.text).join(' ')).toContain('דנה לוי')
  }, 30000)
  it('עמודים: סיבוב + סדר (מחיקת עמוד) + דחיסה', async () => {
    const r = await applyPdf(form, cleanApply({ pages: { rotate: { 0: 90 }, order: [0] }, compress: true }, 2).req)
    expect(r.pages).toBe(1)
    const B = await analyzePdf(r.bytes)
    expect(B.pages[0]!.rotation).toBe(90); expect(B.pages[0]!.w).toBeCloseTo(842)
  }, 30000)
  it('ריצה חוזרת על אותו קובץ — אותם ids ל-spans (העורך שולח id מהניתוח)', async () => {
    const again = await analyzePdf(form)
    expect(again.pages[0]!.spans.map((s) => s.text)).toEqual(A.pages[0]!.spans.map((s) => s.text))
  }, 30000)
})

describe('stampPdf — עברית בסדר הנכון (נמצא בבדיקה: שם נחתם יצא "ןהכ השמ")', () => {
  it('שם וכתובת עם מספר נקראים מהקובץ החתום כמו שנכתבו', async () => {
    const d = await PDFDocument.create(); d.addPage([300, 200])
    const out = await stampPdf(await d.save(), [{ id: 'a', page: 0, kind: 'name', signer: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.1 }, { id: 'b', page: 0, kind: 'text', signer: 1, x: 0.1, y: 0.5, w: 0.8, h: 0.1, label: 'כתובת' }],
      [{ order: 1, name: 'משה כהן', idNumber: '123456782', signedAt: new Date('2026-10-12T10:00:00Z'), values: { b: 'רחוב הרצל 12, תל אביב' }, signaturePng: PNG_1PX }] as never)
    const txt = (await analyzePdf(out)).pages[0]!.spans.map((s) => s.text)
    expect(txt).toContain('משה כהן')
    expect(txt).toContain('רחוב הרצל 12, תל אביב')
  }, 30000)
  it('fontkitRuns: רצף עברי הפוך, לטיני/ספרות כמו שהם', () => {
    expect(fontkitRuns('משה כהן')).toEqual(['משה כהן'])
    expect(fontkitRuns('רחוב הרצל 12')).toEqual(['12', 'רחוב הרצל '])
    expect(fontkitRuns('Bank Leumi')).toEqual(['Bank', ' ', 'Leumi'])
  })
})

describe('באותו גופן ובאותו גודל (דן 31/10: "במקום חובה — זכות")', () => {
  let doc2: Uint8Array, A2: Analysis
  beforeAll(async () => {
    const d = await PDFDocument.create(); d.registerFontkit(fontkit)
    const dv = await d.embedFont(readFileSync('assets/fonts/DejaVuSans.ttf'), { subset: false }) // גופן מלא מוטמע (כמו בדוחות בנק)
    const p = d.addPage([595, 842])
    drawHe(p, dv, 'חובה', 480, 700, 10.5); drawHe(p, dv, 'יתרה', 480, 680, 10.5)
    doc2 = await d.save(); A2 = await analyzePdf(doc2)
  }, 30000)
  it('החלפת מילה באותיות שלא הופיעו במסמך — עדיין בגופן המקורי (cmap של הגופן המלא)', async () => {
    const s = A2.pages[0]!.spans.find((x) => x.text === 'חובה')!
    expect(s.font).toMatch(/DejaVu/)
    const r = await applyPdf(doc2, cleanApply({ edits: [{ page: 0, span: s.id, text: 'זכות' }] }, 1).req)
    expect(r.checks.verified).toBe(1)
    const n = (await analyzePdf(r.bytes)).pages[0]!.spans.find((x) => x.text === 'זכות')!
    expect(n.font).toMatch(/DejaVu/); expect(n.size).toBeCloseTo(10.5, 1)
  }, 30000)
  it('תיבת טקסט חדשה בסגנון של טקסט קיים (match) — אותו גופן, גודל וצבע', async () => {
    const s = A2.pages[0]!.spans.find((x) => x.text === 'יתרה')!
    const r = await applyPdf(doc2, cleanApply({ adds: [{ page: 0, kind: 'text', rect: [300, 300, 420, 316], text: 'זכות 250', match: s.id }] }, 1).req)
    const n = (await analyzePdf(r.bytes)).pages[0]!.spans.find((x) => x.text === 'זכות 250')!
    expect(n.font).toMatch(/DejaVu/); expect(n.size).toBeCloseTo(10.5, 1); expect(n.color).toBe(s.color)
  }, 30000)
})
