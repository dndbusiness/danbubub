import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { llmAvailable } from '@/lib/intake/llm'
import { enqueue, fail, jobOf, queueAlive, JOB_TIMEOUT_MS } from '@/lib/crm/ai-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * claude.use('sample') של הדף — בשרת. שתי דרכים:
 *   · queue (ברירת המחדל, התוכנית: Claude על המנוי) — הבקשה נכנסת לתור (lib/crm/ai-queue.ts), Claude על המנוי
 *     עונה תוך דקות, והשים מושך את הסטטוס (GET ?job=). דלוק רק כשהמעבד חי.
 *   · api — רק אם הוגדר ANTHROPIC_API_KEY (תשלום לפי שימוש — החלטה של דן): תשובה מיידית, זורמת כשורות JSON:
 *     {d:"…"} לכל קטע טקסט, ובסוף {done:true,text,truncated} או {error:{code,message}}.
 * בלי אף אחד מהם: enabled=false, והדף מסתיר את כפתורי הניתוח.
 * מה שחוזר הוא הצעה בלבד (הנחיה 17) — הדף מציג, אדם מאשר.
 */
const MAX_IMAGES = 5
const TIERS = { quick: { effort: 'low', max: 4096 }, default: { effort: 'medium', max: 16000 }, complex: { effort: 'high', max: 32000 } } as const
type Tier = keyof typeof TIERS

async function modeOf(): Promise<'api' | 'queue' | null> {
  if (llmAvailable()) return 'api'
  return (await queueAlive().catch(() => false)) ? 'queue' : null
}

export async function GET(req: Request) {
  const s = await effectiveSession(req)
  if (!s) return NextResponse.json({ enabled: false })
  const job = new URL(req.url).searchParams.get('job')
  if (job) {
    const j = await jobOf(job)
    if (!j) return NextResponse.json({ code: 'not_found', message: 'הבקשה לא נמצאה' }, { status: 404 })
    const late = ['pending', 'working'].includes(j.status) && Date.now() - Date.parse(j.createdAt) > JOB_TIMEOUT_MS
    return NextResponse.json({ status: late ? 'error' : j.status, text: j.text ?? null, error: late ? 'Claude לא ענה בזמן — נסו שוב' : j.error ?? null })
  }
  const mode = await modeOf()
  return NextResponse.json({ enabled: !!mode, mode, limits: { images: { maxCount: MAX_IMAGES } } })
}

/** ביטול בקשה שבתור (הדף לחץ "עצור") */
export async function DELETE(req: Request) {
  if (!(await effectiveSession(req))) return NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  const job = new URL(req.url).searchParams.get('job')
  if (job) await fail(job, 'בוטל', 'cancelled')
  return NextResponse.json({ ok: true })
}

interface Img { media_type?: string; data?: string }
interface Turn { role?: string; content?: unknown }

export async function POST(req: Request) {
  const session = await effectiveSession(req)
  if (!session) return NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  const mode = await modeOf()
  if (!mode) return NextResponse.json({ code: 'not_granted', message: 'Claude לא מחובר לשרת' }, { status: 503 })
  let body: { input?: string | Turn[]; images?: Img[]; modelTier?: string; system?: string; json?: boolean; apply?: unknown; label?: string }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }

  const turns: Turn[] = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : Array.isArray(body.input) ? body.input : []
  if (!turns.length || turns[turns.length - 1]?.role !== 'user') return NextResponse.json({ code: 'invalid_argument', message: 'הקלט חייב להסתיים בפנייה של המשתמש' }, { status: 400 })
  const images = (body.images ?? []).filter((i) => i && typeof i.data === 'string' && /^image\/(jpeg|png|gif|webp)$/.test(i.media_type ?? ''))
  if (images.length > MAX_IMAGES) return NextResponse.json({ code: 'invalid_argument', message: `עד ${MAX_IMAGES} תמונות` }, { status: 400 })

  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t, i) => {
    const text = typeof t.content === 'string' ? t.content : JSON.stringify(t.content ?? '')
    const role = t.role === 'assistant' ? 'assistant' : 'user'
    if (i < turns.length - 1 || !images.length) return { role, content: text }
    return { role, content: [
      ...images.map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.media_type as 'image/jpeg', data: im.data as string } })),
      { type: 'text' as const, text },
    ] }
  })
  const tier: Tier = (['quick', 'default', 'complex'] as const).includes(body.modelTier as Tier) ? (body.modelTier as Tier) : 'default'

  if (mode === 'queue') {
    const job = await enqueue(session, {
      turns: turns.map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: typeof t.content === 'string' ? t.content : JSON.stringify(t.content ?? '') })),
      system: body.system ? String(body.system) : undefined, modelTier: tier, json: !!body.json,
      images: images.map((i) => ({ media_type: i.media_type as string, data: i.data as string })), apply: body.apply, label: body.label,
    })
    return NextResponse.json({ job: job.id, status: job.status })
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (o: unknown) => ctl.enqueue(enc.encode(JSON.stringify(o) + '\n'))
      let text = ''
      try {
        const ms = new Anthropic().beta.messages.stream({
          model: 'claude-opus-5-5',
          max_tokens: TIERS[tier].max,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: TIERS[tier].effort },
          ...(body.system ? { system: String(body.system) } : {}),
          messages,
        }, { signal: req.signal })
        ms.on('text', (d) => { text += d; send({ d }) })
        const msg = await ms.finalMessage()
        if (msg.stop_reason === 'refusal') send({ error: { code: 'refused', message: 'Claude סירב לבקשה', text } })
        else send({ done: true, text, truncated: msg.stop_reason === 'max_tokens' })
      } catch (e) {
        const err = e as { status?: number; message?: string; name?: string }
        const code = req.signal.aborted || err.name === 'APIUserAbortError' ? 'cancelled' : err.status === 429 ? 'rate_limited' : 'upstream_error'
        try { send({ error: { code, message: err.message ?? String(e), text } }) } catch { /* הלקוח כבר ניתק */ }
      } finally {
        try { ctl.close() } catch { /* כבר נסגר */ }
      }
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } })
}
