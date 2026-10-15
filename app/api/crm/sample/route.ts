import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { llmAvailable } from '@/lib/intake/llm'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * claude.use('sample') של הדף — בשרת. דלוק רק כשיש ANTHROPIC_API_KEY בסביבה (החלטת דן: תשלום לפי שימוש).
 * בלי מפתח: GET מחזיר enabled=false והשים מחזיר null — הדף מסתיר את כפתורי הניתוח, בדיוק כמו קודם.
 * התשובה זורמת כשורות JSON: {d:"…"} לכל קטע טקסט, ובסוף {done:true,text,truncated} או {error:{code,message}}.
 * מה שחוזר הוא הצעה בלבד (הנחיה 17) — הדף מציג, אדם מאשר.
 */
const MAX_IMAGES = 5
const TIERS = { quick: { effort: 'low', max: 4096 }, default: { effort: 'medium', max: 16000 }, complex: { effort: 'high', max: 32000 } } as const
type Tier = keyof typeof TIERS

export async function GET(req: Request) {
  const s = await effectiveSession(req)
  return NextResponse.json({ enabled: !!s && llmAvailable(), limits: { images: { maxCount: MAX_IMAGES } } })
}

interface Img { media_type?: string; data?: string }
interface Turn { role?: string; content?: unknown }

export async function POST(req: Request) {
  if (!(await effectiveSession(req))) return NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  if (!llmAvailable()) return NextResponse.json({ code: 'not_granted', message: 'Claude לא מוגדר בשרת (ANTHROPIC_API_KEY)' }, { status: 503 })
  let body: { input?: string | Turn[]; images?: Img[]; modelTier?: string; system?: string }
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
