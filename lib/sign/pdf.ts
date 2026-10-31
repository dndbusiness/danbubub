/**
 * טפסים מ-PDF — עבודה על הקובץ עצמו (pdf-lib, אושר ע"י דן 14/10).
 *   mergePdfs — עד 5 קבצים → מסמך אחד, ומידות כל עמוד (לעורך השדות ולבדיקת התבנית).
 *   stampPdf  — החתימות, השמות, ת"ז, התאריכים והטקסט שהחותמים מילאו — על ה-PDF המקורי,
 *               במקומות שהוצבו. הטקסט נשאר טקסט (ניתן לחיפוש), לא תמונה.
 *   appendPdf — עמוד התיעוד (HTML → Playwright) בסוף המסמך החתום.
 * הגופן: DejaVu Sans (רישיון חופשי, assets/fonts) — כולל עברית. pdf-lib לא עושה bidi,
 * ולכן עברית עוברת visualOrder (lib/rules/sign-pdf) — ונכתבת ברצפים, כי fontkit הופך בעצמו מחרוזת עברית (fontkitRuns).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { fieldText, fontkitRuns, initialsOf, pdfRect, visualOrder, type PageSize, type PdfField } from '@/lib/rules/sign-pdf'

export class PdfInputError extends Error {}

let fontBytes: Promise<Buffer> | null = null
const loadFont = () => (fontBytes ??= readFile(path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')))

async function load(bytes: Uint8Array, name = 'הקובץ'): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    const m = (e as Error).message || ''
    throw new PdfInputError(/encrypt/i.test(m) ? `"${name}" מוגן בסיסמה — נא להעלות עותק בלי הגנה` : `"${name}" לא נקרא כ-PDF תקין`)
  }
}

export const pageSizes = (doc: PDFDocument): PageSize[] => doc.getPages().map((p) => { const { width, height } = p.getSize(); return { w: Math.round(width * 100) / 100, h: Math.round(height * 100) / 100 } })

export async function readPageSizes(bytes: Uint8Array): Promise<PageSize[]> {
  return pageSizes(await load(bytes))
}

/** כמה קבצים → מסמך אחד, לפי הסדר שנבחרו. */
export async function mergePdfs(files: { name: string; bytes: Uint8Array }[]): Promise<{ bytes: Uint8Array; pages: PageSize[] }> {
  if (files.length === 1) {
    const doc = await load(files[0]!.bytes, files[0]!.name)
    return { bytes: files[0]!.bytes, pages: pageSizes(doc) }
  }
  const out = await PDFDocument.create()
  for (const f of files) {
    const src = await load(f.bytes, f.name)
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p)
  }
  const bytes = await out.save()
  return { bytes, pages: pageSizes(out) }
}

export interface StampSigner {
  order: number; name: string; idNumber: string; signedAt: Date; signaturePng: string; values: Record<string, string>
}

const INK = rgb(0.07, 0.09, 0.15)

function fitText(font: PDFFont, text: string, w: number, h: number): number {
  let size = Math.min(h * 0.72, 13)
  while (size > 5 && font.widthOfTextAtSize(text, size) > w - 2) size -= 0.5
  return size
}

function drawText(page: PDFPage, font: PDFFont, raw: string, r: { x: number; y: number; w: number; h: number }) {
  if (!raw) return
  const hebrew = /[֐-׿]/.test(raw)
  const text = visualOrder(raw)
  const size = fitText(font, text, r.w, r.h)
  const tw = font.widthOfTextAtSize(text, size)
  let x = hebrew ? r.x + r.w - tw - 1 : r.x + 1
  // ברצפים — fontkit הופך מחרוזת עברית בעצמו (ראו fontkitRuns)
  for (const run of fontkitRuns(raw)) {
    page.drawText(run, { x, y: r.y + (r.h - size) / 2 + size * 0.18, size, font, color: INK })
    x += font.widthOfTextAtSize(run, size)
  }
}

/** החתימות והטקסטים על ה-PDF המקורי. חותם שאין לו רשומה (לא חתם) — השדות שלו נשארים ריקים. */
export async function stampPdf(source: Uint8Array, fields: PdfField[], signers: StampSigner[]): Promise<Uint8Array> {
  const doc = await load(source)
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(await loadFont(), { subset: true })
  const pages = doc.getPages()
  const sigImg = new Map<number, Awaited<ReturnType<PDFDocument['embedPng']>>>()
  for (const s of signers) {
    const b64 = String(s.signaturePng).replace(/^data:image\/png;base64,/, '')
    sigImg.set(s.order, await doc.embedPng(Buffer.from(b64, 'base64')))
  }
  for (const f of fields) {
    const s = signers.find((x) => x.order === f.signer), page = pages[f.page]
    if (!s || !page) continue
    const { width, height } = page.getSize()
    const r = pdfRect(f, { w: width, h: height })
    if (f.kind === 'signature') {
      const img = sigImg.get(s.order)!
      const k = Math.min(r.w / img.width, r.h / img.height)
      const w = img.width * k, h = img.height * k
      page.drawImage(img, { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, width: w, height: h })
    } else if (f.kind === 'initials') {
      drawText(page, font, initialsOf(s.name), r)
    } else if (f.kind === 'checkbox') {
      if (!s.values[f.id]) continue
      const m = Math.min(r.w, r.h) * 0.2, t = Math.max(0.8, Math.min(r.w, r.h) * 0.08)
      page.drawLine({ start: { x: r.x + m, y: r.y + m }, end: { x: r.x + r.w - m, y: r.y + r.h - m }, thickness: t, color: INK })
      page.drawLine({ start: { x: r.x + m, y: r.y + r.h - m }, end: { x: r.x + r.w - m, y: r.y + m }, thickness: t, color: INK })
    } else {
      drawText(page, font, fieldText(f, s), r)
    }
  }
  return doc.save()
}

/** מסמך + עמודים נוספים בסוף (עמוד התיעוד). */
export async function appendPdf(main: Uint8Array, extra: Uint8Array): Promise<Uint8Array> {
  const doc = await load(main), add = await load(extra, 'עמוד התיעוד')
  for (const p of await doc.copyPages(add, add.getPageIndices())) doc.addPage(p)
  return doc.save()
}
