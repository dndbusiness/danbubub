import { NextResponse } from 'next/server'
import { ocrPages, type OcrPageIn } from '@/lib/pdfedit/engine'
import { loadSource, parseSrc } from '@/lib/pdfedit/source'
import { errOut, guard } from '@/lib/pdfedit/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const box = (b: unknown) => { const o = (b ?? {}) as Record<string, unknown>; const v = ['x0', 'y0', 'x1', 'y1'].map((k) => Number(o[k])); return v.every(Number.isFinite) ? { x0: v[0]!, y0: v[1]!, x1: v[2]!, y1: v[3]! } : null }

/**
 * POST { src, pages: [{ page, dpi, lines }] } — תוצאת ה-OCR מהדפדפן (Tesseract, עברית+אנגלית) → טקסט לעריכה:
 * spans בנקודות של העמוד, גודל משוער, צבע דיו ונייר מהתמונה, ושדות ריקים (קווים/ריבועים מהתמונה + התוויות שנקראו).
 * ה-OCR עצמו רץ בדפדפן — הסריקה לא נשלחת לשירות חיצוני.
 */
export async function POST(req: Request) {
  const g = await guard(req); if (g) return g
  const body = await req.json().catch(() => null) as { src?: unknown; pages?: unknown } | null
  const src = parseSrc(body?.src); if (!src) return NextResponse.json({ code: 'invalid_argument', message: 'לא צוין קובץ' }, { status: 400 })
  const pages: OcrPageIn[] = []
  for (const p of Array.isArray(body?.pages) ? body.pages.slice(0, 60) : []) {
    const page = Number(p?.page), dpi = Number(p?.dpi)
    if (!Number.isInteger(page) || page < 0 || !(dpi >= 50 && dpi <= 600) || !Array.isArray(p?.lines)) continue
    const lines = p.lines.slice(0, 1500).map((l: Record<string, unknown>) => ({
      text: String(l?.text ?? '').slice(0, 2000), bbox: box(l?.bbox), baseline: box(l?.baseline) ?? undefined,
      words: (Array.isArray(l?.words) ? l.words : []).slice(0, 300).map((w: Record<string, unknown>) => ({ text: String(w?.text ?? '').slice(0, 200), bbox: box(w?.bbox), confidence: Number(w?.confidence ?? 100),
        symbols: (Array.isArray(w?.symbols) ? w.symbols : []).slice(0, 200).map((s: Record<string, unknown>) => ({ text: String(s?.text ?? '').slice(0, 4), bbox: box(s?.bbox) })).filter((s: { bbox: unknown }) => s.bbox) })).filter((w: { bbox: unknown }) => w.bbox),
    })).filter((l: { bbox: unknown }) => l.bbox)
    pages.push({ page, dpi, lines })
  }
  if (!pages.length) return NextResponse.json({ code: 'invalid_argument', message: 'אין תוצאות OCR' }, { status: 400 })
  try { const f = await loadSource(src); return NextResponse.json(await ocrPages(f.bytes, pages)) } catch (e) { return errOut(e) }
}
