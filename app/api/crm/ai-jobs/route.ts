import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { claim, complete, fail, jobFiles, pendingJobs } from '@/lib/crm/ai-queue'

export const dynamic = 'force-dynamic'

/**
 * הצד של המעבד בתור הניתוחים (lib/crm/ai-queue.ts) — Claude על המנוי, דרך scripts/ai-queue.mjs.
 * רק הבעלים או השומר (JOBS_SECRET בכותרת x-crm-keeper).
 *   GET                 → הבקשות שממתינות (וזה גם הדופק שמדליק את התור בדף)
 *   GET ?id=…&files=1   → התמונות של בקשה
 *   POST {id, action: 'claim' | 'done' | 'fail', text?, message?}
 */
async function owner(req: Request) {
  const s = await effectiveSession(req)
  return s && s.r === 'owner' ? s : null
}

export async function GET(req: Request) {
  if (!(await owner(req))) return NextResponse.json({ code: 'permission_denied', message: 'רק לבעלים או לשומר' }, { status: 403 })
  const url = new URL(req.url), id = url.searchParams.get('id')
  if (id && url.searchParams.get('files')) return NextResponse.json({ files: await jobFiles(id) })
  return NextResponse.json({ jobs: await pendingJobs() })
}

export async function POST(req: Request) {
  if (!(await owner(req))) return NextResponse.json({ code: 'permission_denied', message: 'רק לבעלים או לשומר' }, { status: 403 })
  let b: { id?: string; action?: string; text?: string; message?: string }
  try { b = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  const id = String(b.id ?? '')
  if (!id) return NextResponse.json({ code: 'invalid_argument', message: 'חסר id' }, { status: 400 })
  if (b.action === 'claim') { const j = await claim(id); return j ? NextResponse.json({ job: j }) : NextResponse.json({ code: 'not_found', message: 'הבקשה כבר טופלה או לא קיימת' }, { status: 409 }) }
  if (b.action === 'done') {
    const text = String(b.text ?? '')
    if (!text.trim()) return NextResponse.json({ code: 'invalid_argument', message: 'תשובה ריקה' }, { status: 400 })
    const j = await complete(id, text)
    return j ? NextResponse.json({ ok: true, applied: j.apply ?? null }) : NextResponse.json({ code: 'not_found', message: 'הבקשה כבר טופלה או בוטלה' }, { status: 409 })
  }
  if (b.action === 'fail') { await fail(id, String(b.message ?? 'נכשל')); return NextResponse.json({ ok: true }) }
  return NextResponse.json({ code: 'invalid_argument', message: 'פעולה לא מוכרת' }, { status: 400 })
}
