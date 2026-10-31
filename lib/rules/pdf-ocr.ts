/**
 * OCR לסרוקים (דן 31/10: "תבנה OCR לסורקים") — החלק הטהור.
 *   ocrSpans  — שורות Tesseract (בדפדפן, heb+eng) → spans בנקודות של העמוד, עם גודל גופן משוער מגובה האותיות
 *   scanVecs  — קווים אופקיים, ריבועים ושורות משבצות מתוך התמונה (Computer Vision פשוט) → אותם Vec כמו בקובץ וקטורי,
 *               כך ש-detectBlanks (pdf-edit.ts) מוצא שדות ריקים גם בסרוק
 *   inkAndPaper — צבע הדיו וצבע הנייר סביב טקסט: עריכה בסרוק = מחיקת הפיקסלים, צביעה בצבע הנייר, וכתיבה בצבע הדיו
 *   ocrLayerFor — השכבה הנסתרת (בר-חיפוש) בלי שורות שנערכו / נמחקו
 * בלי I/O. תמונות: מערך בהירות (0..255) או RGB, שורה אחר שורה.
 */
import { type Rect, type Span, type Vec, colorHex, isRtl } from './pdf-edit.js'

export interface OcrBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrSymbol { text: string; bbox: OcrBox }
export interface OcrWord { text: string; bbox: OcrBox; confidence?: number; symbols?: OcrSymbol[] }
export interface OcrLine { text: string; bbox: OcrBox; baseline?: OcrBox; words: OcrWord[] }

export interface OcrSpan extends Span { ocr: true; conf: number; paper?: string }

const BOXLIKE = /^[\[\]{}()|□☐■▢oO]{1,3}$/
const clean = (s: string) => String(s ?? '').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim()
const r2 = (v: number) => Math.round(v * 100) / 100

/* גובה האות ביחס ל-em (Liberation Sans, נמדד): עברית רגילה 0.60, ספרות/אותיות גדולות 0.69, אותיות קטנות 0.53 */
const HEB_BODY = /^[אבגדהוזחטכמנסעפצרשתםףץ]$/
const UPPER = /^[A-Z0-9]$/
const LOWER_X = /^[acemnorsuvwxz]$/
/** גודל הגופן (בפיקסלים) מגובה האותיות: חציון של גובה/יחס — עמיד לאותיות עולות/יורדות (ל, ק, ן, y…) */
export function estimateSize(symbols: OcrSymbol[], fallbackPx: number): number {
  const est: number[] = []
  for (const s of symbols) {
    const c = s.text, hh = s.bbox.y1 - s.bbox.y0
    if (!(hh > 2)) continue
    if (HEB_BODY.test(c)) est.push(hh / 0.60)
    else if (UPPER.test(c)) est.push(hh / 0.69)
    else if (LOWER_X.test(c)) est.push(hh / 0.53)
  }
  if (est.length < 2) return fallbackPx
  est.sort((a, b) => a - b)
  return est[Math.floor(est.length / 2)]!
}

/**
 * שורות OCR → spans. dpi = הרזולוציה שבה רונדר העמוד ל-OCR (נקודה = dpi/72 פיקסלים).
 * שורה עם רווח גדול בין מילים (תווית ... ערך) מתפצלת לכמה spans, כמו בקובץ וקטורי.
 */
export function ocrSpans(lines: OcrLine[], dpi: number, startId = 0, minConf = 35): OcrSpan[] {
  const k = 72 / dpi, out: OcrSpan[] = []
  for (const l of lines) {
    // ריבוע סימון ריק נקרא לפעמים כ-"[]" / "O" / "□" — זה שדה, לא טקסט
    const words = (l.words ?? []).filter((w) => clean(w.text) && !BOXLIKE.test(clean(w.text)) && (w.confidence ?? 100) >= minConf)
    if (!words.length) continue
    const lh = l.bbox.y1 - l.bbox.y0
    const sizePx = estimateSize(words.flatMap((w) => w.symbols ?? []), lh * 0.82)
    const base = l.baseline && l.baseline.y0 > 0 ? (l.baseline.y0 + l.baseline.y1) / 2 : l.bbox.y1 - lh * 0.18
    // קבוצות לפי רווח (בסדר חזותי, משמאל לימין)
    const vis = words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0)
    const groups: OcrWord[][] = []
    for (const w of vis) { const g = groups[groups.length - 1], last = g?.[g.length - 1]; if (g && last && w.bbox.x0 - last.bbox.x1 < sizePx * 2.2) g.push(w); else groups.push([w]) }
    for (const g of groups) {
      const rtl = g.some((w) => isRtl(w.text))
      const text = (rtl ? g.slice().reverse() : g).map((w) => clean(w.text)).join(' ')
      const rect: Rect = [Math.min(...g.map((w) => w.bbox.x0)), Math.min(...g.map((w) => w.bbox.y0)), Math.max(...g.map((w) => w.bbox.x1)), Math.max(...g.map((w) => w.bbox.y1))]
      out.push({
        id: startId + out.length, text, rect: rect.map((v) => r2(v * k)) as Rect, baseline: r2(base * k), font: 'OCR', size: r2(Math.max(4, Math.min(72, sizePx * k))),
        color: '#000000', bold: false, italic: false, family: 'sans', rtl, ocr: true, conf: Math.round(g.reduce((s, w) => s + (w.confidence ?? 100), 0) / g.length),
      })
    }
  }
  return out
}

/* ── קווים וריבועים בתמונה ── */
export interface Gray { data: Uint8Array | Uint8ClampedArray; w: number; h: number }
interface Seg { y0: number; y1: number; x0: number; x1: number }

/** מקטעים אופקיים כהים (≥ minLen פיקסלים, פערים עד 2px), מאוחדים לעובי. */
export function hSegments(img: Gray, minLen: number, dark = 150, maxThick = 6): Seg[] {
  const { data, w, h } = img, rows: Seg[][] = []
  for (let y = 0; y < h; y++) {
    const row: Seg[] = []; let x0 = -1, gap = 0
    for (let x = 0; x <= w; x++) {
      const on = x < w && data[y * w + x]! < dark
      if (on) { if (x0 < 0) x0 = x; gap = 0 }
      else if (x0 >= 0) { gap++; if (gap > 2 || x === w) { const x1 = x - gap; if (x1 - x0 + 1 >= minLen) row.push({ y0: y, y1: y, x0, x1 }); x0 = -1; gap = 0 } }
    }
    rows.push(row)
  }
  // איחוד שורות סמוכות עם אותו טווח x → קו אחד בעובי כמה פיקסלים
  const open: Seg[] = [], done: Seg[] = []
  for (let y = 0; y < h; y++) {
    for (const s of rows[y]!) {
      const m = open.find((o) => o.y1 === y - 1 && Math.abs(o.x0 - s.x0) <= 3 && Math.abs(o.x1 - s.x1) <= 3)
      if (m) { m.y1 = y; m.x0 = Math.min(m.x0, s.x0); m.x1 = Math.max(m.x1, s.x1) } else open.push({ ...s })
    }
    for (let i = open.length - 1; i >= 0; i--) if (open[i]!.y1 < y) done.push(...open.splice(i, 1))
  }
  done.push(...open)
  return done.filter((s) => s.y1 - s.y0 + 1 <= maxThick)
}
const colDark = (img: Gray, x: number, y0: number, y1: number, dark: number) => {
  let n = 0; for (let y = y0; y <= y1; y++) { const a = img.data[y * img.w + x]!, b = x > 0 ? img.data[y * img.w + x - 1]! : 255, c = x + 1 < img.w ? img.data[y * img.w + x + 1]! : 255; if (Math.min(a, b, c) < dark) n++ }
  return n / Math.max(1, y1 - y0 + 1)
}

/**
 * Vec-ים מתוך התמונה (scale = פיקסלים לנקודה): קווים אופקיים ארוכים (≥ 40pt) + מלבנים סגורים:
 * ריבוע קטן = סימון; מלבן מחולק בקווים אנכיים = משבצות (כל תא Vec, כך ש-detectBlanks מאחד לשורת משבצות);
 * מלבן רחב בלי חלוקה = תיבת טקסט.
 */
export function scanVecs(img: Gray, scale: number, dark = 150): Vec[] {
  const pt = (v: number) => r2(v / scale)
  const out: Vec[] = []
  const segs = hSegments(img, Math.max(5, Math.round(5.5 * scale)), dark, Math.max(3, Math.round(2.2 * scale)))
  const edges = new Set<Seg>()
  // מלבנים: זוג מקטעים מיושרים (למעלה/למטה) עם קווים אנכיים בקצוות
  const cand = segs.filter((s) => (s.x1 - s.x0) / scale <= 400).slice(0, 800)
  const seen: Rect[] = []
  for (const top of cand) for (const bot of cand) {
    if (bot === top || bot.y0 <= top.y1) continue
    const gapPt = (bot.y0 - top.y1) / scale
    if (gapPt < 5 || gapPt > 30 || Math.abs(top.x0 - bot.x0) > 3 || Math.abs(top.x1 - bot.x1) > 3) continue
    const y0 = top.y1 + 1, y1 = bot.y0 - 1, x0 = Math.max(top.x0, bot.x0), x1 = Math.min(top.x1, bot.x1)
    if (colDark(img, x0 + 1, y0, y1, dark) < 0.85 || colDark(img, x1 - 1, y0, y1, dark) < 0.85) continue
    const outer: Rect = [pt(x0), pt(top.y0), pt(x1 + 1), pt(bot.y1 + 1)]
    if (seen.some((r) => Math.abs(r[0] - outer[0]) < 1 && Math.abs(r[1] - outer[1]) < 1 && Math.abs(r[2] - outer[2]) < 1)) continue
    seen.push(outer); edges.add(top); edges.add(bot)
    // קווים אנכיים פנימיים → תאים
    const div: number[] = [x0]
    for (let x = x0 + 3; x < x1 - 2; x++) if (colDark(img, x, y0, y1, dark) >= 0.9) { if (x - div[div.length - 1]! > 3) div.push(x) }
    div.push(x1)
    if (div.length >= 6) for (let i = 0; i + 1 < div.length; i++) out.push({ kind: 'S', rect: [pt(div[i]!), outer[1], pt(div[i + 1]! + 1), outer[3]] })
    else out.push({ kind: 'S', rect: outer })
  }
  // קווים ארוכים שאינם צלע של מלבן (צלע עליונה הייתה מציעה שדה מעל התיבה)
  for (const s of segs) if (!edges.has(s) && (s.x1 - s.x0) / scale >= 40) out.push({ kind: 'S', rect: [pt(s.x0), pt(s.y0), pt(s.x1 + 1), pt(s.y1 + 1)] })
  return out
}

/** צבע הדיו (ממוצע 15% הכהים בתיבה) וצבע הנייר (חציון הבהירים בטבעת סביבה). rgb = 3 בתים לפיקסל. */
export function inkAndPaper(rgb: Uint8Array | Uint8ClampedArray, w: number, h: number, scale: number, rect: Rect): { ink: string; paper: string } {
  const X0 = Math.max(0, Math.floor(rect[0] * scale)), Y0 = Math.max(0, Math.floor(rect[1] * scale)), X1 = Math.min(w - 1, Math.ceil(rect[2] * scale)), Y1 = Math.min(h - 1, Math.ceil(rect[3] * scale))
  const px = (x: number, y: number): [number, number, number] => { const i = (y * w + x) * 3; return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!] }
  const lum = (c: [number, number, number]) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114
  const inside: [number, number, number][] = []
  for (let y = Y0; y <= Y1; y += 1) for (let x = X0; x <= X1; x += 1) inside.push(px(x, y))
  const ring: [number, number, number][] = [], m = Math.max(2, Math.round(2 * scale))
  for (let y = Math.max(0, Y0 - m); y <= Math.min(h - 1, Y1 + m); y++) for (let x = Math.max(0, X0 - m); x <= Math.min(w - 1, X1 + m); x++) if (x < X0 || x > X1 || y < Y0 || y > Y1) ring.push(px(x, y))
  const avg = (a: [number, number, number][]): [number, number, number] => a.length ? [0, 1, 2].map((i) => a.reduce((s, c) => s + c[i]!, 0) / a.length / 255) as [number, number, number] : [0, 0, 0]
  inside.sort((a, b) => lum(a) - lum(b))
  const ink = avg(inside.slice(0, Math.max(1, Math.round(inside.length * 0.15))))
  const light = (ring.length ? ring : inside).slice().sort((a, b) => lum(b) - lum(a))
  const mid = light.slice(0, Math.max(1, Math.round(light.length * 0.6)))
  const paper = mid[Math.floor(mid.length / 2)] ?? [255, 255, 255]
  return { ink: colorHex(ink), paper: colorHex([paper[0] / 255, paper[1] / 255, paper[2] / 255]) }
}

export interface LayerLine { rect: Rect; baseline: number; size: number; text: string }
/** השכבה הנסתרת: בלי שורות שנערכו או שנוגעות באזור שנמחק (שלא יישאר טקסט ישן בר-חיפוש) */
export function ocrLayerFor(lines: LayerLine[], drop: Rect[]): LayerLine[] {
  const hit = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
  return lines.filter((l) => l.text.trim() && !drop.some((d) => hit(l.rect, d)))
}
