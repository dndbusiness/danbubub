import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequest, listForClient } from '@/lib/sign/store'

export const dynamic = 'force-dynamic'

/**
 * חתימה דיגיטלית — צד הצוות (מאחורי שער הכניסה, middleware). הדף של הלקוח: /s/<token>.
 *   GET  ?client=<doc>  → הבקשות של הלקוח (בלי הנוסח והחתימה)
 *   POST               → בקשה חדשה: צילום נוסח + קישור אישי + מייל ללקוח דרך outbox
 */
const Create = z.object({
  clientDoc: z.string().min(1).max(200).regex(/^[^/]+$/),
  clientName: z.string().min(1).max(200),
  division: z.enum(['finance', 'realestate']),
  title: z.string().min(2).max(200),
  template: z.string().min(20).max(60000),
  fields: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.null()])).default({}),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  expiresDays: z.number().int().min(1).max(60).nullish(),
  allowMissing: z.boolean().optional(),
})

export async function GET(req: Request) {
  const client = new URL(req.url).searchParams.get('client') ?? ''
  if (!client || client.includes('/')) return NextResponse.json({ code: 'invalid_argument', message: 'חסר לקוח' }, { status: 400 })
  return NextResponse.json({ requests: await listForClient(client) })
}

export async function POST(req: Request) {
  const parsed = Create.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: 'invalid_argument', message: 'בקשה לא תקינה: ' + parsed.error.issues.map((i) => i.path.join('.')).join(', ') }, { status: 400 })
  const origin = new URL(req.url).origin
  const r = await createRequest(parsed.data, new Date(), origin)
  if ('error' in r) return NextResponse.json({ code: 'missing_fields', message: r.error, missing: r.missing }, { status: 422 })
  return NextResponse.json(r)
}
