import { NextResponse } from 'next/server'
import { analyzePdf } from '@/lib/pdfedit/engine'
import { loadSource, parseSrc } from '@/lib/pdfedit/source'
import { errOut, guard } from '@/lib/pdfedit/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST { src: {drive}|{file} } → לכל עמוד: הטקסט הקיים (spans), שדות ריקים מזוהים, שדות טופס. ראו lib/pdfedit/engine.ts */
export async function POST(req: Request) {
  const g = await guard(req); if (g) return g
  const body = await req.json().catch(() => null) as { src?: unknown } | null
  const src = parseSrc(body?.src); if (!src) return NextResponse.json({ code: 'invalid_argument', message: 'לא צוין קובץ' }, { status: 400 })
  try {
    const f = await loadSource(src)
    const a = await analyzePdf(f.bytes)
    return NextResponse.json({ name: f.name, ...a })
  } catch (e) { return errOut(e) }
}
