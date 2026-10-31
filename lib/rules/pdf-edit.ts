/**
 * עורך ה-PDF (דן 31/10: "כמו pdfFiller") — החלק הטהור: בלי I/O, בלי MuPDF.
 * המנוע (lib/pdfedit/engine.ts) מחלץ תווים וקווים מהעמוד; כאן הופכים אותם ל:
 *   spans   — רצפי טקסט באותו סגנון (פונט/גודל/צבע) באותה שורה, עם הטקסט הלוגי (עברית מימין לשמאל)
 *   blanks  — שדות ריקים: קו אופקי דק, ריבוע קטן (סימון), שורת משבצות (ת״ז), רצף ____ / ......
 *   סגנון   — איזה גופן חלופי (Liberation — אותם מדדים כמו Arial/Times/Courier, כולל עברית) כשהמקורי חסר אותיות
 *   התאמה   — טקסט חדש ארוך מהמקום: קודם דחיסה אופקית (Tz) עד 80%, ואחר כך הקטנת גודל
 * הקואורדינטות כאן הן של העמוד כפי שמוצג: נקודות (1/72"), ראשית בפינה השמאלית העליונה, y גדל כלפי מטה.
 */
import { visualOrder } from './sign-pdf.js'

export type Rect = [number, number, number, number] // x0, y0, x1, y1

export interface PdfChar {
  c: string
  rect: Rect          // תיבת התו
  origin: [number, number] // נקודת קו הבסיס
  font: string
  size: number
  color: [number, number, number] // 0..1
  line: number        // מספר השורה (מה-stext)
  hidden?: boolean    // טקסט נסתר (Tr 3 — שכבת OCR)
}

export interface Span {
  id: number
  text: string        // לוגי — כמו שקוראים
  rect: Rect
  baseline: number    // y של קו הבסיס
  font: string
  size: number
  color: string       // #rrggbb
  bold: boolean
  italic: boolean
  family: FontFamily
  rtl: boolean
  hidden?: boolean    // טקסט נסתר (שכבת OCR של סורק) — עריכה = מחיקת הפיקסלים שמתחת, לא רק הגליפים
  paper?: string      // בסרוק: צבע הנייר סביב הטקסט (לצביעה אחרי מחיקת הפיקסלים)
}

export type FontFamily = 'sans' | 'serif' | 'mono'
export interface FontStyle { family: FontFamily; bold: boolean; italic: boolean }

const HEB = /[֐-׿]/
export const isRtl = (s: string) => HEB.test(String(s ?? ''))

/** טקסט כפי שמופיע על העמוד משמאל לימין ↔ הטקסט הלוגי. visualOrder הופכי לעצמו (הפיכת רצפים + מראה של סוגריים). */
export const visualToLogical = (s: string) => visualOrder(s)
export const logicalToVisual = (s: string) => visualOrder(s)

/** "ABCDEF+Arial-BoldMT" → משפחה/מודגש/נטוי. שמות עבריים נפוצים: David/Frank/Narkis = serif; Miriam/Arial/Tahoma = sans. */
export function fontStyle(name: string): FontStyle {
  const n = String(name ?? '').replace(/^[A-Z]{6}\+/, '')
  const bold = /bold|black|heavy|semibold|demi|,b\b|-bd\b/i.test(n)
  const italic = /italic|oblique|,i\b|-it\b|-bi\b/i.test(n)
  const family: FontFamily = /courier|mono|consol|fixed/i.test(n) ? 'mono'
    : /times|serif|david|frank|narkis|georgia|garamond|roman|cambria|book/i.test(n) && !/sans/i.test(n) ? 'serif' : 'sans'
  return { family, bold, italic }
}

/** קובץ הגופן החלופי — assets/fonts/liberation/ */
export function fallbackFile(st: FontStyle): string {
  const fam = st.family === 'serif' ? 'Serif' : st.family === 'mono' ? 'Mono' : 'Sans'
  const sty = st.bold && st.italic ? 'BoldItalic' : st.bold ? 'Bold' : st.italic ? 'Italic' : 'Regular'
  return `Liberation${fam}-${sty}.ttf`
}

export const FALLBACK_KEYS = ['sans', 'sans-bold', 'sans-italic', 'sans-bolditalic', 'serif', 'serif-bold', 'serif-italic', 'serif-bolditalic', 'mono', 'mono-bold', 'mono-italic', 'mono-bolditalic'] as const
export const fallbackKey = (st: FontStyle) => st.family + (st.bold && st.italic ? '-bolditalic' : st.bold ? '-bold' : st.italic ? '-italic' : '')
export function fileOfKey(key: string): string | null {
  if (!(FALLBACK_KEYS as readonly string[]).includes(key)) return null
  const [fam = 'sans', sty = ''] = key.split('-')
  return fallbackFile({ family: fam as FontFamily, bold: sty.includes('bold'), italic: sty.includes('italic') })
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
export const colorHex = (c: [number, number, number]) => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2])
export function hexColor(s: string | null | undefined): [number, number, number] {
  const m = String(s ?? '').match(/^#?([0-9a-f]{6})$/i); if (!m) return [0, 0, 0]
  const n = parseInt(m[1]!, 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const sameStyle = (a: PdfChar, b: PdfChar) => a.font === b.font && !a.hidden === !b.hidden && Math.abs(a.size - b.size) < 0.25 &&
  a.color.every((v, i) => Math.abs(v - b.color[i]!) < 0.02)

/**
 * תווים → spans. באותה שורה (line), לפי x; span חדש כשהסגנון משתנה או כשיש רווח גדול (עמודה אחרת / תווית וקו).
 * רווחים בקצוות לא נכללים בתיבה. פקודות שפוצלו לאות-אות בקובץ מתאחדות כאן לטקסט אחד.
 */
export function groupSpans(chars: PdfChar[]): Span[] {
  const byLine = new Map<number, PdfChar[]>()
  for (const ch of chars) { const a = byLine.get(ch.line); if (a) a.push(ch); else byLine.set(ch.line, [ch]) }
  const out: Span[] = []
  const flush = (run: PdfChar[]) => {
    let a = 0, b = run.length - 1
    while (a <= b && !run[a]!.c.trim()) a++
    while (b >= a && !run[b]!.c.trim()) b--
    if (a > b) return
    const r = run.slice(a, b + 1), f = r[0]!
    const visual = r.map((x) => x.c).join('')
    const rtl = isRtl(visual), st = fontStyle(f.font)
    out.push({
      id: out.length, text: rtl ? visualToLogical(visual) : visual,
      rect: [Math.min(...r.map((x) => x.rect[0])), Math.min(...r.map((x) => x.rect[1])), Math.max(...r.map((x) => x.rect[2])), Math.max(...r.map((x) => x.rect[3]))].map(round2) as Rect,
      baseline: round2(f.origin[1]), font: f.font.replace(/^[A-Z]{6}\+/, ''), size: round2(f.size), color: colorHex(f.color),
      bold: st.bold, italic: st.italic, family: st.family, rtl, ...(f.hidden ? { hidden: true } : {}),
    })
  }
  for (const line of [...byLine.keys()].sort((x, y) => x - y)) {
    const cs = byLine.get(line)!.slice().sort((x, y) => x.rect[0] - y.rect[0])
    let run: PdfChar[] = []
    for (const ch of cs) {
      const prev = run[run.length - 1]
      const gap = prev ? ch.rect[0] - prev.rect[2] : 0
      const blank = !ch.c.trim()
      if (prev && ((!blank && prev.c.trim() && !sameStyle(prev, ch)) || gap > Math.max(prev.size, ch.size) * 1.2)) { flush(run); run = [] }
      run.push(ch)
    }
    flush(run)
  }
  return out
}

/** רצפי ____ / ...... / ‥‥ בתוך השורות — מקום למילוי (בטפסים שמודפסים בלי קווים גרפיים). */
export function underscoreRuns(chars: PdfChar[]): { rect: Rect; size: number }[] {
  const out: { rect: Rect; size: number }[] = []
  const byLine = new Map<number, PdfChar[]>()
  for (const ch of chars) { const a = byLine.get(ch.line); if (a) a.push(ch); else byLine.set(ch.line, [ch]) }
  for (const cs0 of byLine.values()) {
    const cs = cs0.slice().sort((x, y) => x.rect[0] - y.rect[0])
    let run: PdfChar[] = []
    const end = () => { const dots = run.every((x) => x.c === '.' || x.c === '…' || x.c === '‥')
      const f = run[0], l = run[run.length - 1]
      if (f && l && run.length >= (dots ? 6 : 4)) out.push({ rect: [f.rect[0], f.rect[1], l.rect[2], f.rect[3]].map(round2) as Rect, size: f.size })
      run = [] }
    for (const ch of cs) { if (/^[_.…‥]$/.test(ch.c) && (!run.length || (ch.c === '_') === (run[0]!.c === '_'))) run.push(ch); else end() }
    end()
  }
  return out
}

export interface Vec { kind: 'S' | 'F'; rect: Rect }
export type BlankKind = 'text' | 'checkbox' | 'comb' | 'signature' | 'date' | 'name' | 'id_number'
export interface Blank { page: number; rect: Rect; kind: BlankKind; label: string; cells?: number; from: 'line' | 'box' | 'comb' | 'underscore' | 'field' }

const LABEL_KIND: [RegExp, BlankKind][] = [
  [/חתימ|signature/i, 'signature'],
  [/תאריך|date/i, 'date'],
  [/ת\.?\s*ז|ת"ז|ת״ז|תעודת\s+זהות|מס(?:פר|')?\s+זהות|\bid\b/i, 'id_number'],
  [/^(?:שם|name)\b|שם\s+(?:מלא|ה?לווה|ה?לקוח|ה?מבקש|פרטי|משפחה)|full\s*name/i, 'name'],
]
export function kindFromLabel(label: string): BlankKind | null {
  const t = String(label ?? '').trim(); if (!t) return null
  for (const [re, k] of LABEL_KIND) if (re.test(t)) return k
  return null
}
const cleanLabel = (s: string) => String(s ?? '').replace(/[:：_.…*]+\s*$/, '').replace(/^\s*[:：*]+/, '').replace(/\s+/g, ' ').trim().slice(0, 40)

const round2 = (v: number) => Math.round(v * 100) / 100
const w = (r: Rect) => r[2] - r[0]
const h = (r: Rect) => r[3] - r[1]
const overlapX = (a: Rect, b: Rect) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
const overlapY = (a: Rect, b: Rect) => Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
const area = (r: Rect) => Math.max(0, w(r)) * Math.max(0, h(r))
const iou = (a: Rect, b: Rect) => { const i = overlapX(a, b) * overlapY(a, b); return i / Math.max(1e-6, Math.min(area(a), area(b))) }

/** התווית של שדה: הטקסט הקרוב באותה שורה — מימין (עברית) ואם אין, משמאל; אחרת מעליו (עד 14pt). */
export function labelFor(field: Rect, spans: Span[]): string {
  const cy = (field[1] + field[3]) / 2
  const sameRow = spans.filter((s) => s.text.replace(/[_.…\s]/g, '') && s.rect[1] - 3 <= cy && s.rect[3] + 3 >= cy)
  const right = sameRow.filter((s) => s.rect[0] >= field[2] - 2 && s.rect[0] - field[2] < 140).sort((a, b) => a.rect[0] - b.rect[0])[0]
  const left = sameRow.filter((s) => s.rect[2] <= field[0] + 2 && field[0] - s.rect[2] < 140).sort((a, b) => b.rect[2] - a.rect[2])[0]
  const pick = right && (right.rtl || !left) ? right : left ?? right
  if (pick) return cleanLabel(pick.text)
  const above = spans.filter((s) => overlapX(s.rect, field) > 0 && field[1] - s.rect[3] >= -1 && field[1] - s.rect[3] < 14).sort((a, b) => b.rect[3] - a.rect[3])[0]
  return above ? cleanLabel(above.text) : ''
}

/**
 * שדות ריקים בעמוד. הצעה בלבד — העורך מציג אותם, ואדם מחליט (הנחיה 17).
 *   קו: גובה ≤ 2pt, רוחב ≥ 40pt, לא מעל 85% מרוחב העמוד (קו מפריד), ואין טקסט שיושב עליו (= קו תחתון של טקסט / כבר מולא).
 *   ריבוע 6–14pt = סימון. 4+ תיבות צמודות באותה שורה = משבצות (ת״ז, מספר חשבון) → שדה אחד.
 */
export function detectBlanks(page: number, pageW: number, vecs: Vec[], spans: Span[], unders: { rect: Rect; size: number }[]): Blank[] {
  const out: Blank[] = []
  const typical = (() => { const s = spans.map((x) => x.size).sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 10 })()
  const fieldH = Math.max(10, Math.min(20, typical * 1.5))
  const textOn = (r: Rect) => spans.some((s) => s.text.replace(/[_.…\s]/g, '') && overlapX(s.rect, r) > Math.min(w(r), w(s.rect)) * 0.5 && s.rect[3] >= r[1] - 4 && s.rect[3] <= r[1] + 2)
  // תיבות קטנות: ריבועים (סימון) ומלבנים צרים (משבצות)
  const boxes: Rect[] = []
  for (const v of vecs) {
    const r = v.rect, W = w(r), H = h(r)
    if (H <= 2 && W >= 40 && W <= pageW * 0.85) {
      const line: Rect = [r[0], r[1] - fieldH, r[2], r[1]]
      if (!textOn(r)) out.push({ page, rect: line.map(round2) as Rect, kind: 'text', label: '', from: 'line' })
    } else if (W >= 6 && W <= 26 && H >= 6 && H <= 30) {
      if (!boxes.some((b) => iou(b, r) > 0.8)) boxes.push(r)
    } else if (v.kind === 'S' && W >= 40 && W <= pageW * 0.85 && H >= 10 && H <= 30) {
      // תיבה רחבה ריקה (טופס עם מסגרת לכל שדה)
      if (!spans.some((s) => s.text.replace(/[_.…\s]/g, '') && iou(s.rect, r) > 0.3)) out.push({ page, rect: [r[0] + 1, r[1] + 1, r[2] - 1, r[3] - 1].map(round2) as Rect, kind: 'text', label: '', from: 'field' })
    }
  }
  // משבצות: 4+ תיבות באותה שורה, דומות, צמודות
  const used = new Set<Rect>()
  const sorted = boxes.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0])
  for (const b of sorted) {
    if (used.has(b)) continue
    const row = sorted.filter((x) => !used.has(x) && Math.abs(x[1] - b[1]) < 1.5 && Math.abs(h(x) - h(b)) < 1.5 && Math.abs(w(x) - w(b)) < 2).sort((x, y) => x[0] - y[0])
    const chain: Rect[] = []
    for (const x of row) { const last = chain[chain.length - 1]; if (!last || (x[0] - last[2] < 3.5 && x[0] - last[2] > -1.5)) chain.push(x); else if (chain.length < 4) { chain.length = 0; chain.push(x) } else break }
    const c0 = chain[0], cl = chain[chain.length - 1]
    if (c0 && cl && chain.length >= 4) { chain.forEach((x) => used.add(x)); out.push({ page, rect: [c0[0], c0[1], cl[2], c0[3]].map(round2) as Rect, kind: 'comb', label: '', cells: chain.length, from: 'comb' }) }
  }
  for (const b of boxes) if (!used.has(b) && Math.abs(w(b) - h(b)) <= 2.5 && w(b) <= 14) {
    const hasText = spans.some((s) => s.text.trim() && iou(s.rect, b) > 0.5)
    if (!hasText) out.push({ page, rect: b.map(round2) as Rect, kind: 'checkbox', label: '', from: 'box' })
  }
  for (const u of unders) out.push({ page, rect: [u.rect[0], u.rect[3] - fieldH, u.rect[2], u.rect[3]].map(round2) as Rect, kind: 'text', label: '', from: 'underscore' })
  // כפילויות (קו גרפי + ____ באותו מקום)
  const dedup: Blank[] = []
  for (const b of out) if (!dedup.some((x) => iou(x.rect, b.rect) > 0.5)) dedup.push(b)
  for (const b of dedup) {
    b.label = labelFor(b.rect, spans)
    if (b.kind === 'text') { const k = kindFromLabel(b.label); if (k) b.kind = k }
  }
  return dedup.sort((a, b) => a.rect[1] - b.rect[1] || b.rect[0] - a.rect[0]).slice(0, 200)
}

/** הטקסט החדש ארוך מהמקום: דחיסה אופקית עד 80%, ואם לא מספיק — גם הקטנת גודל (לא מתחת ל-5pt). */
export function fitText(width: number, avail: number, size: number): { size: number; scale: number } {
  if (!(width > 0) || !(avail > 0) || width <= avail + 0.01) return { size, scale: 1 }
  const k = avail / width
  if (k >= 0.8) return { size, scale: Math.floor(k * 1000) / 1000 }
  return { size: Math.max(5, Math.floor(size * (k / 0.8) * 100) / 100), scale: 0.8 }
}

/** ToUnicode לגופן שהוטמע מחדש (CID = מזהה הגליף) — כדי שהטקסט החדש יהיה בר-חיפוש והעתקה. */
export function toUnicodeCMap(pairs: [number, number][]): string {
  const uniq = new Map<number, number>(); for (const [g, u] of pairs) if (g > 0 && g < 65536 && u > 0 && !uniq.has(g)) uniq.set(g, u)
  const h4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')
  const u16 = (cp: number) => cp > 0xffff ? h4(0xd800 + ((cp - 0x10000) >> 10)) + h4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : h4(cp)
  const items = [...uniq.entries()].sort((a, b) => a[0] - b[0])
  let body = ''
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100)
    body += `${chunk.length} beginbfchar\n` + chunk.map(([g, u]) => `<${h4(g)}> <${u16(u)}>`).join('\n') + '\nendbfchar\n'
  }
  return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    body + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
}

/* ── בקשת השמירה: מה העורך שולח, ובדיקה לפני שנוגעים בקובץ ── */
export type AddKind = 'text' | 'check' | 'cross' | 'date' | 'image' | 'highlight' | 'draw'
export interface EditOp { page: number; span: number; text: string }
export interface EraseOp { page: number; rect: Rect; fill?: string }
/** עריכה בסרוק: מוחקים את הפיקסלים (וטקסט נסתר) בתיבה, צובעים בצבע הנייר, וכותבים את החדש על קו הבסיס */
export interface OcrEditOp { page: number; rect: Rect; text: string; size: number; baseline: number; color?: string; paper?: string }
export interface OcrLayerOp { page: number; lines: { rect: Rect; baseline: number; size: number; text: string }[] }
export interface AddOp { page: number; kind: AddKind; rect: Rect; text?: string; size?: number; color?: string; image?: string; points?: [number, number][][]; width?: number; family?: FontFamily; bold?: boolean; match?: number /* span בעמוד שממנו לוקחים גופן/גודל/צבע */ }
export interface PageOps { order?: number[]; rotate?: Record<string, number> }
export interface ApplyReq { edits: EditOp[]; erase: EraseOp[]; adds: AddOp[]; form: Record<string, string | boolean>; flatten: boolean; pages: PageOps; compress: boolean; ocrEdits: OcrEditOp[]; ocrLayer: OcrLayerOp[] }

export const MAX_OPS = 600
const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null }
const rectOf = (v: unknown): Rect | null => {
  if (!Array.isArray(v) || v.length !== 4) return null
  const r = v.map((x) => num(x, -20000, 20000)); if (r.some((x) => x == null)) return null
  const [x0, y0, x1, y1] = r as Rect; return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null
}
const ADD_KINDS: AddKind[] = ['text', 'check', 'cross', 'date', 'image', 'highlight', 'draw']

/** בדיקת הבקשה מהדפדפן. מחזיר בקשה נקייה או רשימת שגיאות — בלי לזרוק. */
export function cleanApply(raw: unknown, pageCount: number): { req: ApplyReq; errors: string[] } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const errors: string[] = []
  const pg = (v: unknown) => { const n = num(v, 0, pageCount - 1); return n != null && Number.isInteger(n) ? n : null }
  const edits: EditOp[] = []
  for (const e of Array.isArray(b.edits) ? b.edits : []) {
    const p = pg(e?.page), s = num(e?.span, 0, 1e6), t = typeof e?.text === 'string' ? e.text.replace(/[\r\n]+/g, ' ').slice(0, 2000) : null
    if (p == null || s == null || t == null) { errors.push('עריכת טקסט לא תקינה'); continue }
    edits.push({ page: p, span: s, text: t })
  }
  const erase: EraseOp[] = []
  const hexOk = (v: unknown) => v == null || /^#[0-9a-f]{6}$/i.test(String(v))
  for (const e of Array.isArray(b.erase) ? b.erase : []) { const p = pg(e?.page), r = rectOf(e?.rect); if (p == null || !r || !hexOk(e?.fill)) { errors.push('אזור מחיקה לא תקין'); continue } erase.push({ page: p, rect: r, ...(e.fill ? { fill: String(e.fill) } : {}) }) }
  const ocrEdits: OcrEditOp[] = []
  for (const e of Array.isArray(b.ocrEdits) ? b.ocrEdits : []) {
    const p = pg(e?.page), r = rectOf(e?.rect), size = num(e?.size, 4, 72), base = num(e?.baseline, -20000, 20000), t = typeof e?.text === 'string' ? e.text.replace(/[\r\n]+/g, ' ').slice(0, 2000) : null
    if (p == null || !r || size == null || base == null || t == null || !hexOk(e?.color) || !hexOk(e?.paper)) { errors.push('עריכה בסרוק לא תקינה'); continue }
    ocrEdits.push({ page: p, rect: r, text: t, size, baseline: base, ...(e.color ? { color: String(e.color) } : {}), ...(e.paper ? { paper: String(e.paper) } : {}) })
  }
  const ocrLayer: OcrLayerOp[] = []
  let layerLines = 0
  for (const o of Array.isArray(b.ocrLayer) ? b.ocrLayer : []) {
    const p = pg(o?.page); if (p == null || !Array.isArray(o?.lines)) { errors.push('שכבת OCR לא תקינה'); continue }
    const lines: OcrLayerOp['lines'] = []
    for (const l of o.lines.slice(0, 2000)) { const r = rectOf(l?.rect), size = num(l?.size, 2, 120), base = num(l?.baseline, -20000, 20000); if (!r || size == null || base == null || typeof l?.text !== 'string' || !l.text.trim()) continue; lines.push({ rect: r, size, baseline: base, text: l.text.slice(0, 1000) }) }
    layerLines += lines.length; if (lines.length) ocrLayer.push({ page: p, lines })
  }
  if (layerLines > 20000) errors.push('שכבת OCR גדולה מדי')
  const adds: AddOp[] = []
  for (const a of Array.isArray(b.adds) ? b.adds : []) {
    const p = pg(a?.page), r = rectOf(a?.rect), k = ADD_KINDS.includes(a?.kind) ? a.kind as AddKind : null
    if (p == null || !r || !k) { errors.push('תוספת לא תקינה'); continue }
    const o: AddOp = { page: p, kind: k, rect: r }
    if (k === 'text' || k === 'date') { const t = typeof a.text === 'string' ? a.text.slice(0, 4000) : ''; if (!t.trim()) continue; o.text = t; if (a.family === 'serif' || a.family === 'mono') o.family = a.family; if (a.bold) o.bold = true
      const m = num(a.match, 0, 1e6); if (m != null && Number.isInteger(m)) o.match = m
      const sz = num(a.size, 4, 72); if (sz != null) o.size = sz; else if (o.match == null) o.size = 11 }
    if (a.color != null) { if (!/^#[0-9a-f]{6}$/i.test(String(a.color))) { errors.push('צבע לא תקין'); continue } o.color = String(a.color) }
    if (k === 'image') { const m = String(a.image ?? '').match(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/); if (!m || String(a.image).length > 6_000_000) { errors.push('תמונה לא תקינה (PNG/JPEG עד ~4MB)'); continue } o.image = String(a.image) }
    if (k === 'draw') {
      const strokes = (Array.isArray(a.points) ? a.points : []).slice(0, 200).map((s: unknown) => (Array.isArray(s) ? s : []).slice(0, 2000).map((q: unknown) => Array.isArray(q) && q.length === 2 ? [num(q[0], -20000, 20000), num(q[1], -20000, 20000)] : [null, null]).filter((q: (number | null)[]) => q[0] != null && q[1] != null) as [number, number][]).filter((s: [number, number][]) => s.length >= 2)
      if (!strokes.length) continue; o.points = strokes; o.width = num(a.width, 0.3, 12) ?? 1.5
    }
    adds.push(o)
  }
  const form: Record<string, string | boolean> = {}
  if (b.form && typeof b.form === 'object') for (const [k, v] of Object.entries(b.form as Record<string, unknown>).slice(0, 500)) if (typeof v === 'string') form[k.slice(0, 200)] = v.slice(0, 2000); else if (typeof v === 'boolean') form[k.slice(0, 200)] = v
  const pages: PageOps = {}
  const P = (b.pages && typeof b.pages === 'object' ? b.pages : {}) as Record<string, unknown>
  if (Array.isArray(P.order)) {
    const ord = P.order.map((x) => pg(x)); if (ord.some((x) => x == null) || !ord.length || new Set(ord).size !== ord.length) errors.push('סדר העמודים לא תקין'); else pages.order = ord as number[]
  }
  if (P.rotate && typeof P.rotate === 'object') { const rot: Record<string, number> = {}
    for (const [k, v] of Object.entries(P.rotate as Record<string, unknown>)) { const p = pg(k), d = Number(v); if (p == null || ![0, 90, 180, 270].includes(((d % 360) + 360) % 360)) { errors.push('סיבוב לא תקין'); continue } if (d % 360) rot[p] = ((d % 360) + 360) % 360 }
    if (Object.keys(rot).length) pages.rotate = rot }
  const total = edits.length + erase.length + adds.length + Object.keys(form).length + ocrEdits.length
  if (total > MAX_OPS) errors.push(`יותר מדי שינויים בבת אחת (${total}, עד ${MAX_OPS})`)
  return { req: { edits, erase, adds, form, flatten: b.flatten === true, pages, compress: b.compress === true, ocrEdits, ocrLayer }, errors }
}

/** תיבה שמכווצת מעט לפני מחיקת הטקסט הישן — כדי לא לגעת בשורה שמעל/מתחת (מלכודת 6.4 במפרט של דן). */
export const shrinkForRedact = (r: Rect): Rect => { const dy = Math.min(1.5, h(r) * 0.18), dx = Math.min(0.6, w(r) * 0.02); return [r[0] + dx, r[1] + dy, r[2] - dx, r[3] - dy] }

/** "מסמך.pdf" → "מסמך (ערוך).pdf" */
export function editedName(name: string): string {
  const n = String(name ?? '').trim() || 'מסמך'
  const base = n.replace(/\.pdf$/i, '').replace(/\s*\(ערוך(?: \d+)?\)$/, '')
  return base + ' (ערוך).pdf'
}
