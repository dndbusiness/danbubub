/** PDF → טקסט (ב.3 שלב 3). pdf-parse (טהור JS). OCR עברי לסרוקים — לא מחובר (שאלה #31). */
import { PDFParse } from 'pdf-parse'

export async function pdfToText(buf: Buffer): Promise<{ text: string; pages: number; needsOcr: boolean }> {
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  try {
    const r = await parser.getText()
    const text = r.text ?? ''
    const letters = (text.match(/\p{L}/gu) ?? []).length
    return { text, pages: r.total ?? 0, needsOcr: letters < 20 }
  } finally {
    await parser.destroy().catch(() => {})
  }
}
