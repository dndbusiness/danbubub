import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'

export const dynamic = 'force-dynamic'

/** רשימת השלוחות בחשבון (Organizational Extension List) — לבחירת שלוחה לכל משתמש בהגדרות. רק דן. */
export async function GET(req: Request) {
  const s = await effectiveSession(req)
  if (!s || s.r !== 'owner') return NextResponse.json({ code: 'permission_denied' }, { status: 403 })
  const code = process.env.VOICENTER_CODE
  if (!code) return NextResponse.json({ extensions: [], message: 'חסר קוד וויאסנטר בשרת' })
  try {
    const r = await fetch('https://monitor.voicenter.co.il/Comet/api/GetExtensions?code=' + encodeURIComponent(code), { signal: AbortSignal.timeout(10000) })
    const j = await r.json().catch(() => null) as unknown
    const arr = Array.isArray(j) ? j : j && typeof j === 'object' ? (Object.values(j as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ?? [] : []
    const pick = (o: Record<string, unknown>, re: RegExp) => { const k = Object.keys(o).find((x) => re.test(x)); return k ? String(o[k] ?? '') : '' }
    const extensions = arr.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((o) => ({ ext: pick(o, /^(sip|extension|ext|username|user)$/i) || pick(o, /sip|exten/i), name: pick(o, /name/i) })).filter((x) => x.ext)
    return NextResponse.json({ extensions })
  } catch (e) {
    return NextResponse.json({ extensions: [], message: 'המרכזייה לא ענתה: ' + (e as Error).message })
  }
}
