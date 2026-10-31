/**
 * עורך ה-PDF — המנוע (MuPDF, WASM; אותה ספרייה שמאחורי PyMuPDF). דן 31/10: "כמו pdfFiller".
 *
 *   analyzePdf — לכל עמוד: spans (טקסט קיים עם פונט/גודל/צבע/מיקום), שדות ריקים מזוהים, שדות AcroForm, האם סרוק.
 *   applyPdf   — עריכת span (מחיקה אמיתית של הגליפים הישנים מה-Content Stream + כתיבה באותו מקום),
 *                מחיקת אזור, תוספות (טקסט/✓/✗/תאריך/תמונה/חתימה/סימון/ציור), מילוי טופס, סיבוב/מחיקה/סידור עמודים, דחיסה.
 *
 * בחירת הגופן לטקסט חדש (לפי הסדר):
 *   1. הגופן המקורי המוטמע — אם כל האותיות כבר מופיעות בו במסמך (subset: רק מה שהיה במקור; ממפים תו → גליף מהטקסט עצמו).
 *      מוטמע מחדש עם ToUnicode, כדי שהטקסט יהיה בר-חיפוש.
 *   2. Liberation באותה משפחה/משקל (אותם מדדים כמו Arial/Times/Courier, כולל עברית) — assets/fonts/liberation.
 *   3. DejaVu Sans — לתווים שאין גם ב-Liberation.
 * עברית: נכתבת בסדר חזותי (visualOrder) ומיושרת לקצה הימני של הטקסט הישן; טקסט לטיני — לקצה השמאלי.
 * הטקסט הישן לא "מכוסה בלבן" — הוא נמחק מהקובץ (redaction), כך שאי אפשר להעתיק אותו (מלכודת 6.6).
 * רישיון: MuPDF הוא AGPL-3.0 — מותר כאן כי קוד המערכת פתוח (המאגר ציבורי). אם המאגר ייסגר — צריך רישיון מסחרי מ-Artifex או מנוע אחר.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  type AddOp, type ApplyReq, type Blank, type PdfChar, type Rect, type Span, type Vec,
  detectBlanks, fallbackFile, fitText, fontStyle, groupSpans, hexColor, isRtl, logicalToVisual, shrinkForRedact, toUnicodeCMap, underscoreRuns,
} from '../rules/pdf-edit.js'

type MU = typeof import('mupdf')
type Matrix = [number, number, number, number, number, number]
let muP: Promise<MU> | null = null
const mu = () => (muP ??= import('mupdf'))

export class PdfEditError extends Error { constructor(public code: string, message: string) { super(message) } }

export const MAX_EDIT_PAGES = 60

export interface WidgetInfo { name: string; type: string; value: string; rect: Rect; options?: string[]; readOnly: boolean }
export interface PageInfo { w: number; h: number; rotation: number; spans: Span[]; blanks: Blank[]; widgets: WidgetInfo[]; scanned: boolean }
export interface Analysis { pages: PageInfo[]; truncated: boolean }

/* ── פענוח עמוד ── */
const rgbOf = (c: ArrayLike<number> | null | undefined): [number, number, number] => {
  const a = Array.from(c ?? [], Number), v = (i: number) => a[i] ?? 0
  if (a.length === 1) return [v(0), v(0), v(0)]
  if (a.length === 4) { const k = v(3); return [(1 - v(0)) * (1 - k), (1 - v(1)) * (1 - k), (1 - v(2)) * (1 - k)] }
  return a.length >= 3 ? [v(0), v(1), v(2)] : [0, 0, 0]
}
const at = (q: ArrayLike<number>, i: number) => q[i] ?? 0
const quadRect = (q: ArrayLike<number>): Rect => [Math.min(at(q, 0), at(q, 4)), Math.min(at(q, 1), at(q, 3)), Math.max(at(q, 2), at(q, 6)), Math.max(at(q, 5), at(q, 7))]
const apply = (m: ArrayLike<number>, x: number, y: number): [number, number] => [at(m, 0) * x + at(m, 2) * y + at(m, 4), at(m, 1) * x + at(m, 3) * y + at(m, 5)]

interface GlyphFont { font: InstanceType<MU['Font']>; map: Map<string, number> }
interface PageScan { chars: PdfChar[]; vecs: Vec[]; imageArea: number; glyphs: Map<string, GlyphFont> }

function scanPage(M: MU, page: InstanceType<MU['PDFPage']>): PageScan {
  const chars: PdfChar[] = []
  let line = -1
  page.toStructuredText('preserve-whitespace').walk({
    beginLine() { line++ },
    onChar(c, origin, font, size, quad, color) { chars.push({ c, rect: quadRect(quad), origin: [at(origin, 0), at(origin, 1)], font: font.getName(), size, color: rgbOf(color as unknown as number[]), line }) },
  })
  const vecs: Vec[] = []
  let imageArea = 0
  const glyphs = new Map<string, GlyphFont>()
  const subpaths = (p: InstanceType<MU['Path']>, ctm: ArrayLike<number>, kind: 'S' | 'F') => {
    let pts: [number, number][] = []
    const end = () => { if (pts.length >= 2) { const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); vecs.push({ kind, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }) } pts = [] }
    p.walk({ moveTo(x, y) { end(); pts.push(apply(ctm, x, y)) }, lineTo(x, y) { pts.push(apply(ctm, x, y)) }, curveTo(_a, _b, _c, _d, x, y) { pts.push(apply(ctm, x, y)) }, closePath() {} })
    end()
  }
  const dev = new M.Device({
    fillPath(p, _eo, ctm) { if (vecs.length < 5000) subpaths(p, ctm, 'F') },
    strokePath(p, _st, ctm) { if (vecs.length < 5000) subpaths(p, ctm, 'S') },
    fillImage(_img, ctm) { imageArea += Math.abs(at(ctm, 0) * at(ctm, 3) - at(ctm, 1) * at(ctm, 2)) },
    fillText(text) {
      text.walk({ showGlyph(font, _trm, gid, uni) {
        if (uni <= 0 || gid <= 0) return
        const n = font.getName(); let g = glyphs.get(n); if (!g) { g = { font, map: new Map() }; glyphs.set(n, g) }
        const ch = String.fromCodePoint(uni); if (!g.map.has(ch)) g.map.set(ch, gid)
      } })
    },
  })
  page.run(dev, M.Matrix.identity)
  dev.close()
  return { chars, vecs, imageArea, glyphs }
}

function widgetsOf(page: InstanceType<MU['PDFPage']>): WidgetInfo[] {
  try {
    return page.getWidgets().slice(0, 300).map((w) => ({
      name: w.getName(), type: w.getFieldType(), value: w.getValue(), rect: Array.from(w.getRect()) as Rect,
      ...(w.isChoice() ? { options: w.getOptions().slice(0, 100) } : {}), readOnly: w.isReadOnly(),
    }))
  } catch { return [] }
}

async function openPdf(bytes: Uint8Array) {
  const M = await mu()
  let doc: InstanceType<MU['Document']>
  try { doc = M.Document.openDocument(bytes, 'application/pdf') } catch { throw new PdfEditError('invalid_argument', 'הקובץ לא נפתח כ-PDF') }
  const pdf = doc.asPDF(); if (!pdf) throw new PdfEditError('invalid_argument', 'הקובץ לא PDF')
  if (pdf.needsPassword()) throw new PdfEditError('invalid_argument', 'ה-PDF נעול בסיסמה — צריך לפתוח אותו בלי סיסמה')
  return { M, pdf }
}

function pageInfo(page: InstanceType<MU['PDFPage']>, i: number, scan: PageScan): PageInfo {
  const b = page.getBounds(), w = b[2] - b[0], h = b[3] - b[1]
  const spans = groupSpans(scan.chars)
  const blanks = detectBlanks(i, w, scan.vecs, spans, underscoreRuns(scan.chars))
  const rotation = Number(page.getObject().getInheritable('Rotate').asNumber?.() ?? 0) || 0
  return { w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100, rotation, spans, blanks, widgets: widgetsOf(page), scanned: !scan.chars.some((c) => c.c.trim()) && scan.imageArea > w * h * 0.4 }
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  const { pdf } = await openPdf(bytes)
  try { return pdf.countPages() } finally { pdf.destroy() }
}

export async function analyzePdf(bytes: Uint8Array, maxPages = MAX_EDIT_PAGES): Promise<Analysis> {
  const { M, pdf } = await openPdf(bytes)
  try {
    const n = pdf.countPages(), pages: PageInfo[] = []
    for (let i = 0; i < Math.min(n, maxPages); i++) { const page = pdf.loadPage(i) as InstanceType<MU['PDFPage']>; pages.push(pageInfo(page, i, scanPage(M, page))) }
    return { pages, truncated: n > maxPages }
  } finally { pdf.destroy() }
}

/* ── גופנים חלופיים ── */
const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')
const fontFiles = new Map<string, Promise<Buffer>>()
export const readFallbackFont = (file: string) => {
  let p = fontFiles.get(file)
  if (!p) { p = readFile(file === 'DejaVuSans.ttf' ? path.join(FONT_DIR, file) : path.join(FONT_DIR, 'liberation', file)); fontFiles.set(file, p) }
  return p
}

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString()
const mat = (m: ArrayLike<number>) => Array.from(m).map(f3).join(' ')
const rg = (c: [number, number, number]) => c.map(f3).join(' ')

export interface ApplyResult { bytes: Uint8Array; pages: number; checks: { edits: number; verified: number; warnings: string[] } }

export async function applyPdf(bytes: Uint8Array, req: ApplyReq): Promise<ApplyResult> {
  const { M, pdf } = await openPdf(bytes)
  const warnings: string[] = []
  try {
    const nPages = pdf.countPages()
    const fallback = new Map<string, InstanceType<MU['Font']>>()
    const getFallback = async (file: string) => { let f = fallback.get(file); if (!f) { f = new M.Font(file.replace(/\.ttf$/, ''), await readFallbackFont(file)); fallback.set(file, f) } return f }
    const embedded = new Map<InstanceType<MU['Font']> | string, InstanceType<MU['PDFObject']>>()
    let resN = 0
    const touched = new Set<number>([...req.edits, ...req.erase, ...req.adds].map((o) => o.page))
    const formOn = Object.keys(req.form).length > 0
    if (formOn || req.flatten) for (let i = 0; i < nPages; i++) touched.add(i)
    const editedSpans: { page: number; rect: Rect; old: string; text: string }[] = []

    for (const pi of [...touched].sort((a, b) => a - b)) {
      if (pi >= nPages) continue
      const page = pdf.loadPage(pi) as InstanceType<MU['PDFPage']>
      const scan = scanPage(M, page)
      const spans = groupSpans(scan.chars)
      const inv = M.Matrix.invert(page.getTransform()) as Matrix
      const ops: string[] = []
      const pobj = page.getObject()
      // המשאבים נקראים מחדש בכל פעם: מחיקת הטקסט (redaction) כותבת לעמוד content ו-Resources חדשים
      const resources = () => { let res = pobj.getInheritable('Resources'); if (res.isNull()) { res = pdf.newDictionary(); pobj.put('Resources', res) } return res }
      const sub = (key: string) => { const res = resources(); let d = res.get(key); if (d.isNull()) { d = pdf.newDictionary(); res.put(key, d) } return d }
      const newRes = (key: string, prefix: string, ref: InstanceType<MU['PDFObject']>) => { const d = sub(key); let name: string; do { name = prefix + (++resN) } while (!d.get(name).isNull()); d.put(name, ref); return name }
      const pageW = at(page.getBounds(), 2)

      // הגופן לטקסט: המקורי אם יש בו את כל האותיות, אחרת Liberation באותו סגנון, ולתווים חסרים — DejaVu
      const chooseFont = async (visual: string, origName: string | null, style: { family: 'sans' | 'serif' | 'mono'; bold: boolean; italic: boolean }) => {
        const cs = [...visual]
        const g = origName ? scan.glyphs.get(origName) : null
        if (g && cs.every((c) => g.map.has(c))) return { font: g.font, gids: cs.map((c) => g.map.get(c)!), orig: g }
        for (const file of [fallbackFile(style), 'DejaVuSans.ttf']) {
          const f = await getFallback(file), gids = cs.map((c) => f.encodeCharacter(c.codePointAt(0)!))
          if (gids.every((x, i) => x > 0 || !cs[i]?.trim()) || file === 'DejaVuSans.ttf') return { font: f, gids: gids.map((x) => Math.max(0, x)), orig: null }
        }
        throw new Error('unreachable')
      }
      const fontRes = (font: InstanceType<MU['Font']>, orig: GlyphFont | null) => {
        let ref = embedded.get(font)
        if (!ref) {
          ref = pdf.addFont(font)
          if (orig) { // subset מהמסמך — בלי cmap; ToUnicode מהמיפוי שנאסף מהטקסט עצמו
            const desc = ref.resolve()
            desc.put('ToUnicode', pdf.addStream(toUnicodeCMap([...orig.map.entries()].map(([c, gid]) => [gid, c.codePointAt(0)!])), {}))
          }
          embedded.set(font, ref)
        }
        return newRes('Font', 'HEf', ref)
      }
      // שורת טקסט אחת: x = קצה שמאלי (במרחב העמוד), y = קו הבסיס
      const writeLine = async (text: string, o: { left: number; right: number; baseline: number; size: number; color: [number, number, number]; rtl: boolean; origFont: string | null; style: { family: 'sans' | 'serif' | 'mono'; bold: boolean; italic: boolean }; avail: number }) => {
        const visual = isRtl(text) ? logicalToVisual(text) : text
        const { font, gids, orig } = await chooseFont(visual, o.origFont, o.style)
        const adv = gids.reduce((s, g) => s + font.advanceGlyph(g, 0), 0)
        const fit = fitText(adv * o.size, o.avail, o.size)
        const width = adv * fit.size * fit.scale
        const x = o.rtl ? o.right - width : o.left
        const trm = M.Matrix.concat([fit.size * fit.scale, 0, 0, -fit.size, x, o.baseline], inv)
        const name = fontRes(font, orig)
        ops.push(`BT /${name} 1 Tf ${rg(o.color)} rg ${mat(trm)} Tm <${gids.map((g) => g.toString(16).padStart(4, '0')).join('')}> Tj ET`)
        return { orig: !!orig }
      }
      const pathOps = (pts: [number, number][], close: boolean) => pts.map((p, i) => { const q = apply(inv, p[0], p[1]); return f3(q[0]) + ' ' + f3(q[1]) + (i ? ' l' : ' m') }).join(' ') + (close ? ' h' : '')

      // 1. עריכות: מחיקת הגליפים הישנים (רק טקסט — קווים ותמונות נשארים)
      const edits = req.edits.filter((e) => e.page === pi)
      const live: { span: Span; text: string }[] = []
      for (const e of edits) {
        const s = spans[e.span]; if (!s) { warnings.push(`עמוד ${pi + 1}: הטקסט לעריכה לא נמצא (אולי הקובץ השתנה)`); continue }
        if (e.text === s.text) continue
        const a = page.createAnnotation('Redact'); a.setRect(shrinkForRedact(s.rect)); a.update()
        live.push({ span: s, text: e.text })
      }
      if (live.length) page.applyRedactions(false, M.PDFPage.REDACT_IMAGE_NONE, M.PDFPage.REDACT_LINE_ART_NONE, M.PDFPage.REDACT_TEXT_REMOVE)
      // 2. מחיקת אזור — טקסט, תמונה (הפיקסלים) וקווים שבתוכו
      const er = req.erase.filter((e) => e.page === pi)
      for (const e of er) { const a = page.createAnnotation('Redact'); a.setRect(e.rect); a.update() }
      if (er.length) page.applyRedactions(false, M.PDFPage.REDACT_IMAGE_PIXELS, M.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED, M.PDFPage.REDACT_TEXT_REMOVE)

      // 3. הטקסט החדש במקום הישן
      for (const { span: s, text } of live) {
        editedSpans.push({ page: pi, rect: s.rect, old: s.text, text })
        if (!text.trim()) continue
        const rtl = isRtl(text) || (s.rtl && !/[A-Za-z]/.test(text))
        const sameLine = spans.filter((o) => o !== s && o.rect[1] < s.baseline && o.rect[3] > s.baseline - s.size * 0.5)
        const w0 = s.rect[2] - s.rect[0], cap = Math.max(w0 * 1.6, w0 + 60)
        const avail = rtl
          ? Math.min(cap, s.rect[2] - Math.max(14, ...sameLine.filter((o) => o.rect[2] <= s.rect[0] + 1).map((o) => o.rect[2] + 3)))
          : Math.min(cap, Math.min(pageW - 14, ...sameLine.filter((o) => o.rect[0] >= s.rect[2] - 1).map((o) => o.rect[0] - 3)) - s.rect[0])
        await writeLine(text, { left: s.rect[0], right: s.rect[2], baseline: s.baseline, size: s.size, color: hexColor(s.color), rtl, origFont: scan.chars.find((c) => c.font.replace(/^[A-Z]{6}\+/, '') === s.font)?.font ?? null, style: fontStyle(s.font), avail: Math.max(avail, w0) })
      }

      // 4. תוספות
      for (const a of req.adds.filter((x) => x.page === pi)) await addOne(a)
      async function addOne(a: AddOp) {
        const [x0, y0, x1, y1] = a.rect, W = x1 - x0, H = y1 - y0
        const color = hexColor(a.color ?? (a.kind === 'highlight' ? '#ffe14d' : '#111827'))
        if (a.kind === 'text' || a.kind === 'date') {
          const size = a.size ?? 11, lines = String(a.text ?? '').split(/\r?\n/).slice(0, 80)
          for (let i = 0; i < lines.length; i++) {
            const ln = lines[i] ?? ''; if (!ln.trim()) continue
            const rtl = isRtl(ln)
            await writeLine(ln, { left: x0 + 1, right: x1 - 1, baseline: y0 + size * 0.92 + i * size * 1.25, size, color, rtl, origFont: null, style: { family: a.family ?? 'sans', bold: !!a.bold, italic: false }, avail: W - 2 })
          }
        } else if (a.kind === 'check' || a.kind === 'cross') {
          const lw = Math.max(0.8, Math.min(W, H) * 0.12)
          const P = (fx: number, fy: number): [number, number] => [x0 + W * fx, y0 + H * fy]
          const body = a.kind === 'check' ? pathOps([P(0.14, 0.55), P(0.4, 0.82), P(0.88, 0.16)], false) : pathOps([P(0.18, 0.18), P(0.82, 0.82)], false) + ' ' + pathOps([P(0.82, 0.18), P(0.18, 0.82)], false)
          ops.push(`q ${rg(color)} RG ${f3(lw)} w 1 J 1 j ${body} S Q`)
        } else if (a.kind === 'highlight') {
          const gs = pdf.newDictionary(); gs.put('Type', pdf.newName('ExtGState')); gs.put('ca', pdf.newReal(0.38)); gs.put('BM', pdf.newName('Multiply'))
          const n = newRes('ExtGState', 'HEg', pdf.addObject(gs))
          ops.push(`q /${n} gs ${rg(color)} rg ${pathOps([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true)} f Q`)
        } else if (a.kind === 'draw') {
          ops.push(`q ${rg(color)} RG ${f3(a.width ?? 1.5)} w 1 J 1 j ` + (a.points ?? []).map((s) => pathOps(s, false) + ' S').join(' ') + ' Q')
        } else if (a.kind === 'image' && a.image) {
          let img: InstanceType<MU['Image']>
          try { img = new M.Image(Buffer.from(a.image.slice(a.image.indexOf(',') + 1), 'base64')) } catch { warnings.push(`עמוד ${pi + 1}: תמונה לא נקראה`); return }
          const n = newRes('XObject', 'HEi', pdf.addImage(img))
          // ריבוע היחידה של התמונה → התיבה (פינה שמאלית-תחתונה = (x0,y1) במרחב העמוד)
          ops.push(`q ${mat(M.Matrix.concat([W, 0, 0, -H, x0, y1], inv))} cm /${n} Do Q`)
        }
      }

      // 5. טופס: מילוי לפי שם; "שיטוח" = כותבים את הערכים כטקסט (כולל עברית) ומסירים את השדות
      if (formOn || req.flatten) {
        for (const w of page.getWidgets()) {
          const name = w.getName(), has = Object.prototype.hasOwnProperty.call(req.form, name), v = has ? req.form[name] : undefined
          try {
            if (w.isCheckbox() || w.isRadioButton()) { if (has && (w.getValue() !== 'Off' && w.getValue() !== '') !== !!v) w.toggle() }
            else if (w.isChoice()) { if (has && typeof v === 'string') w.setChoiceValue(v) }
            else if (w.isText() && has && typeof v === 'string' && !w.isReadOnly()) w.setTextValue(v)
          } catch { warnings.push(`שדה "${name}" לא התעדכן`) }
          if (req.flatten) {
            const r = Array.from(w.getRect()) as Rect, val = w.getValue()
            if ((w.isCheckbox() || w.isRadioButton()) && val && val !== 'Off') await addOne({ page: pi, kind: 'check', rect: r })
            else if (!w.isButton() && val) { const hh = r[3] - r[1], size = Math.max(6, Math.min(12, hh * 0.7)); await writeLine(val, { left: r[0] + 2, right: r[2] - 2, baseline: r[1] + (hh + size * 0.7) / 2, size, color: [0, 0, 0], rtl: isRtl(val), origFont: null, style: { family: 'sans', bold: false, italic: false }, avail: r[2] - r[0] - 4 }) }
            page.deleteAnnotation(w)
          }
        }
      }

      if (ops.length) {
        const cont = pobj.get('Contents'), arr = pdf.newArray()
        arr.push(pdf.addStream('q\n', {}))
        if (cont.isArray()) cont.forEach((x: InstanceType<MU['PDFObject']>) => arr.push(x)); else if (!cont.isNull()) arr.push(cont)
        arr.push(pdf.addStream('Q\n' + ops.join('\n') + '\n', {}))
        pobj.put('Contents', arr)
      }
    }
    const acro = pdf.getTrailer().get('Root').get('AcroForm')
    if (req.flatten && !acro.isNull()) pdf.getTrailer().get('Root').delete('AcroForm')
    else if (formOn && !acro.isNull()) acro.put('NeedAppearances', true)

    // 6. עמודים: סיבוב, ואז סדר (עמוד שלא ברשימה — נמחק)
    for (const [k, d] of Object.entries(req.pages.rotate ?? {})) {
      const o = (pdf.loadPage(Number(k)) as InstanceType<MU['PDFPage']>).getObject(), cur = Number(o.getInheritable('Rotate').asNumber?.() ?? 0) || 0
      o.put('Rotate', ((cur + d) % 360 + 360) % 360)
    }
    if (req.pages.order) pdf.rearrangePages(req.pages.order)

    const out = pdf.saveToBuffer(req.compress ? 'garbage=deduplicate,compress=yes,compress-images=yes,compress-fonts=yes,clean=yes' : 'garbage=compact,compress=yes').asUint8Array().slice()
    const pages = pdf.countPages()

    // 7. בדיקה: הטקסט הישן באמת נמחק מהקובץ והחדש נכתב (על הקובץ שנשמר, לפני סידור העמודים)
    let verified = 0
    if (editedSpans.length && !req.pages.order) {
      const chk = M.Document.openDocument(out, 'application/pdf').asPDF()!
      try {
        for (const e of editedSpans) {
          const pg = chk.loadPage(e.page) as InstanceType<MU['PDFPage']>, sp = groupSpans(scanPage(M, pg).chars)
          const near = sp.filter((s) => s.rect[1] < e.rect[3] + 2 && s.rect[3] > e.rect[1] - 2).map((s) => s.text).join(' ')
          const norm = (t: string) => t.replace(/\s+/g, '')
          const newOk = !e.text.trim() || norm(near).includes(norm(e.text))
          const oldGone = !e.old.trim() || norm(e.text).includes(norm(e.old)) || !norm(near).includes(norm(e.old))
          if (newOk && oldGone) verified++
          else warnings.push(`עמוד ${e.page + 1}: "${e.old.slice(0, 30)}" → "${e.text.slice(0, 30)}" — ${!oldGone ? 'הטקסט הישן עדיין בקובץ' : 'הטקסט החדש לא נקרא בחזרה'}`)
        }
      } finally { chk.destroy() }
    }
    return { bytes: out, pages, checks: { edits: editedSpans.length, verified, warnings } }
  } finally { pdf.destroy() }
}
