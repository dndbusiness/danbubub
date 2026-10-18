import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'

describe('pdfToText — בלי DOMMatrix בסביבה (כמו ב-Vercel, 18/10)', () => {
  it('הייבוא לא קורס, והטקסט מחולץ', async () => {
    delete (globalThis as { DOMMatrix?: unknown }).DOMMatrix
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica)
    d.addPage().drawText('Invoice total 1234.50', { x: 50, y: 700, font: f, size: 12 })
    const { pdfToText } = await import('@/lib/intake/pdf')
    const r = await pdfToText(Buffer.from(await d.save()))
    expect(r.text).toContain('Invoice total 1234.50')
    expect(r.pages).toBe(1)
  })
})
