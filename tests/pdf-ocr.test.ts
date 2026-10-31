import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { estimateSize, hSegments, inkAndPaper, ocrLayerFor, ocrSpans, scanVecs, type OcrLine } from '../lib/rules/pdf-ocr'
import { cleanApply, detectBlanks } from '../lib/rules/pdf-edit'
import { analyzePdf, applyPdf, ocrPages, type Analysis } from '../lib/pdfedit/engine'

const B = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 })
const sym = (t: string, x: number, h: number, base = 100) => ({ text: t, bbox: B(x, base - h, x + 10, base) })

describe('estimateSize / ocrSpans', () => {
  it('גודל מגובה האותיות — חציון, עמיד ל-ל ול-ק', () => {
    // 12pt ב-200dpi = 33.3px: אות עברית רגילה = 0.60em = 20px
    const s = [sym('ש', 0, 20), sym('ל', 10, 27), sym('ו', 20, 20), sym('ם', 30, 20), sym('ק', 40, 30)]
    expect(estimateSize(s, 10)).toBeCloseTo(33.3, 0)
    expect(estimateSize([sym('A', 0, 23), sym('1', 10, 23), sym('x', 20, 17.6)], 5)).toBeCloseTo(33.3, 0)
    expect(estimateSize([], 17)).toBe(17)
  })
  it('שורה → span בנקודות: סדר קריאה בעברית, בלי סימני כיוון, פיצול בפער גדול', () => {
    const line: OcrLine = { text: 'שם הלווה: ישראל ‎12‏', bbox: B(200, 80, 1500, 112), baseline: B(200, 104, 1500, 104), words: [
      { text: 'ישראל', bbox: B(1100, 80, 1240, 104), confidence: 90, symbols: [sym('י', 1100, 11, 104), sym('ש', 1110, 20, 104), sym('ר', 1120, 20, 104), sym('א', 1130, 20, 104)] },
      { text: 'הלווה:', bbox: B(1260, 80, 1400, 104), confidence: 90 },
      { text: 'שם', bbox: B(1420, 80, 1500, 104), confidence: 90 },
      { text: '‎12‏', bbox: B(200, 82, 260, 104), confidence: 80 },
      { text: 'רעש', bbox: B(600, 82, 640, 104), confidence: 10 },
      { text: '[]', bbox: B(1520, 82, 1550, 104), confidence: 90 },
    ] }
    const sp = ocrSpans([line], 200)
    expect(sp.map((s) => s.text)).toEqual(['12', 'שם הלווה: ישראל'])
    const s = sp[1]!
    expect(s.rtl).toBe(true); expect(s.ocr).toBe(true)
    expect(s.rect[0]).toBeCloseTo(1100 * 72 / 200); expect(s.baseline).toBeCloseTo(104 * 72 / 200)
    expect(s.size).toBeCloseTo((20 / 0.6) * 72 / 200, 1)
  })
})

/* תמונה סינתטית: רקע 245, קו, ריבוע, שורת משבצות, תיבה רחבה */
function img(w: number, h: number) { const d = new Uint8Array(w * h).fill(245); const rect = (x0: number, y0: number, x1: number, y1: number, v = 20) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) d[y * w + x] = v }
  const box = (x0: number, y0: number, x1: number, y1: number) => { rect(x0, y0, x1, y0 + 1); rect(x0, y1 - 1, x1, y1); rect(x0, y0, x0 + 1, y1); rect(x1 - 1, y0, x1, y1) }
  return { d, w, h, rect, box } }

describe('scanVecs — קווים וריבועים מהתמונה', () => {
  it('קו ארוך, ריבוע סימון, משבצות, תיבה רחבה — ו-detectBlanks מזהה אותם', () => {
    const I = img(1200, 800), S = 2 // 2px לנקודה
    I.rect(100, 100, 400, 101)                          // קו 150pt
    I.box(900, 200, 920, 220)                           // ריבוע 10pt
    for (let i = 0; i < 9; i++) I.box(100 + i * 28, 300, 128 + i * 28, 336) // 9 משבצות 14x18pt (צמודות)
    I.box(500, 500, 900, 540)                           // תיבה 200x20pt
    I.rect(0, 700, 1199, 701)                           // קו מפריד לכל הרוחב
    const v = scanVecs({ data: I.d, w: I.w, h: I.h }, S)
    const b = detectBlanks(0, 600, v, [], [])
    expect(b.filter((x) => x.from === 'line').length).toBe(1)
    expect(b.find((x) => x.kind === 'checkbox')).toBeTruthy()
    expect(b.find((x) => x.kind === 'comb')?.cells).toBe(9)
    expect(b.find((x) => x.from === 'field')?.rect[0]).toBeCloseTo(251, 0)
    expect(hSegments({ data: I.d, w: I.w, h: I.h }, 30).length).toBeGreaterThan(5)
  })
  it('צבע דיו וצבע נייר', () => {
    const w = 60, h = 40, rgbA = new Uint8Array(w * h * 3)
    for (let i = 0; i < w * h; i++) { rgbA[i * 3] = 240; rgbA[i * 3 + 1] = 236; rgbA[i * 3 + 2] = 220 }
    for (let y = 15; y < 25; y++) for (let x = 20; x < 40; x++) { const i = (y * w + x) * 3; rgbA[i] = 20; rgbA[i + 1] = 40; rgbA[i + 2] = 120 }
    const c = inkAndPaper(rgbA, w, h, 2, [8, 6, 22, 14])
    expect(c.ink).toBe('#142878'); expect(c.paper).toBe('#f0ecdc')
  })
  it('שכבה נסתרת בלי שורות שנערכו/נמחקו', () => {
    const L = [{ rect: [0, 0, 10, 10] as [number, number, number, number], baseline: 9, size: 10, text: 'א' }, { rect: [0, 20, 10, 30] as [number, number, number, number], baseline: 29, size: 10, text: 'ב' }]
    expect(ocrLayerFor(L, [[2, 2, 4, 4]]).map((l) => l.text)).toEqual(['ב'])
  })
})

/* סרוק סינתטי: טופס וקטורי → תמונה (144dpi) → PDF של תמונה בלבד */
let vec: Uint8Array, scan: Uint8Array, V: Analysis
beforeAll(async () => {
  const d = await PDFDocument.create(); d.registerFontkit(fontkit)
  const he = await d.embedFont(readFileSync('assets/fonts/liberation/LiberationSans-Regular.ttf'), { subset: true })
  const p = d.addPage([595, 842])
  const right = (t: string, x: number, y: number, size = 12) => p.drawText(t, { x: x - he.widthOfTextAtSize(t, size), y, size, font: he, color: rgb(0.05, 0.1, 0.35) })
  right('שם הלווה: ישראל ישראלי', 545, 760); right('תאריך:', 545, 700, 11)
  p.drawLine({ start: { x: 360, y: 698 }, end: { x: 500, y: 698 }, thickness: 1 })
  p.drawRectangle({ x: 535, y: 650, width: 10, height: 10, borderWidth: 1, borderColor: rgb(0, 0, 0) }); right('מאשר את התנאים', 528, 651, 11)
  right('הערה פנימית למחיקה', 545, 600, 11)
  vec = await d.save(); V = await analyzePdf(vec)
  const md = mupdf.Document.openDocument(vec, 'application/pdf'), png = md.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false).asPNG()
  const s = await PDFDocument.create(), im = await s.embedPng(png); s.addPage([595, 842]).drawImage(im, { x: 0, y: 0, width: 595, height: 842 })
  scan = await s.save()
}, 30000)
// "OCR" מדומה: השורות מהטופס הווקטורי, בקואורדינטות של 144dpi (כמו ש-Tesseract מחזיר)
const fakeOcr = (): OcrLine[] => V.pages[0]!.spans.map((s) => { const k = 2, bx = B(s.rect[0] * k, s.rect[1] * k, s.rect[2] * k, s.rect[3] * k)
  return { text: s.text, bbox: bx, baseline: B(bx.x0, s.baseline * k, bx.x1, s.baseline * k), words: [{ text: s.text, bbox: bx, confidence: 95 }] } })

describe('סרוק מקצה לקצה (בלי Tesseract — שורות מדומות)', () => {
  it('ניתוח: העמוד סרוק, אין טקסט; שדות ריקים מהתמונה (קו + ריבוע)', async () => {
    const A = await analyzePdf(scan)
    expect(A.pages[0]!.scanned).toBe(true); expect(A.pages[0]!.spans).toEqual([])
    expect(A.pages[0]!.blanks.some((b) => b.from === 'line')).toBe(true)
    expect(A.pages[0]!.blanks.some((b) => b.kind === 'checkbox')).toBe(true)
  }, 30000)
  it('OCR → spans עם צבע הדיו מהתמונה, ושדות ריקים עם תוויות', async () => {
    const r = await ocrPages(scan, [{ page: 0, dpi: 144, lines: fakeOcr() }])
    const p = r.pages[0]!
    const name = p.spans.find((s) => s.text.includes('ישראלי'))!
    expect(name.color).toMatch(/^#[0-3][0-9a-f][0-3][0-9a-f][3-7][0-9a-f]$/) // כחול כהה
    expect(name.paper).toBe('#ffffff')
    expect(p.blanks.find((b) => b.kind === 'date')?.label).toBe('תאריך')
    expect(p.blanks.find((b) => b.kind === 'checkbox')?.label).toBe('מאשר את התנאים')
  }, 30000)
  it('שמירה: עריכה בסרוק (פיקסלים נמחקים + טקסט חדש) + שכבה בר-חיפוש; השורה שנערכה לא בשכבה', async () => {
    const p = (await ocrPages(scan, [{ page: 0, dpi: 144, lines: fakeOcr() }])).pages[0]!
    const name = p.spans.find((s) => s.text.includes('ישראלי'))!, note = p.spans.find((s) => s.text.includes('למחיקה'))!
    const ops = cleanApply({
      ocrEdits: [{ page: 0, rect: name.rect, text: 'שם הלווה: משה כהן', size: name.size, baseline: name.baseline, color: name.color, paper: name.paper }, { page: 0, rect: note.rect, text: '', size: note.size, baseline: note.baseline, paper: note.paper }],
      ocrLayer: [{ page: 0, lines: p.spans.map((s) => ({ rect: s.rect, baseline: s.baseline, size: s.size, text: s.text })) }],
    }, 1)
    expect(ops.errors).toEqual([])
    const out = await applyPdf(scan, ops.req)
    expect(out.checks).toMatchObject({ edits: 2, verified: 2, warnings: [] })
    const A = await analyzePdf(out.bytes), sp = A.pages[0]!.spans
    expect(sp.find((s) => s.text === 'שם הלווה: משה כהן' && !s.hidden)).toBeTruthy()
    expect(sp.filter((s) => s.hidden).map((s) => s.text)).toEqual(expect.arrayContaining(['תאריך:', 'מאשר את התנאים']))
    expect(sp.some((s) => /ישראלי|למחיקה/.test(s.text))).toBe(false)
    expect(A.pages[0]!.scanned).toBe(true)
    // הפיקסלים של ההערה נמחקו מהתמונה עצמה
    const md = mupdf.Document.openDocument(out.bytes, 'application/pdf'), pix = md.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceGray, false)
    const px = pix.getPixels(), W = pix.getWidth(); let dark = 0
    for (let y = Math.floor(note.rect[1] * 2); y < Math.ceil(note.rect[3] * 2); y++) for (let x = Math.floor(note.rect[0] * 2); x < Math.ceil(note.rect[2] * 2); x++) if (px[y * W + x]! < 128) dark++
    expect(dark).toBe(0)
  }, 30000)
})
