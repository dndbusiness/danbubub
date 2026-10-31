import { NextResponse } from 'next/server'
import { applyPdf, countPages } from '@/lib/pdfedit/engine'
import { loadSource, parseSrc, saveResult } from '@/lib/pdfedit/source'
import { errOut, guard } from '@/lib/pdfedit/http'
import { cleanApply, editedName } from '@/lib/rules/pdf-edit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST { src, ops, name? } → הקובץ הערוך נשמר כקובץ חדש ליד המקור (דרייב: אותה תיקייה; מערכת: stored_files).
 * המקור לא נדרס. מחזיר איפה נשמר + בדיקה שהטקסט הישן באמת נמחק והחדש נקרא.
 */
export async function POST(req: Request) {
  const g = await guard(req); if (g) return g
  const body = await req.json().catch(() => null) as { src?: unknown; ops?: unknown; name?: unknown } | null
  const src = parseSrc(body?.src); if (!src) return NextResponse.json({ code: 'invalid_argument', message: 'לא צוין קובץ' }, { status: 400 })
  try {
    const f = await loadSource(src)
    const { req: ops, errors } = cleanApply(body?.ops, await countPages(f.bytes))
    if (errors.length) return NextResponse.json({ code: 'invalid_argument', message: [...new Set(errors)].join(' · ') }, { status: 422 })
    const r = await applyPdf(f.bytes, ops)
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().replace(/\.pdf$/i, '').slice(0, 150) + '.pdf' : editedName(f.name)
    const saved = await saveResult(src, f, r.bytes, name)
    return NextResponse.json({ saved, pages: r.pages, size: r.bytes.byteLength, checks: r.checks })
  } catch (e) { return errOut(e) }
}
