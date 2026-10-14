import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createEnvelope, envelopeCounts, listEnvelopes } from '@/lib/sign/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * מערכת החתימות — צד הצוות (מאחורי שער הכניסה, middleware). הדף של החותם: /s/<token>.
 *   GET  ?client=<doc>                 → המסמכים של הלקוח (v_sign_overview)
 *   GET  ?all=1[&state=][&division=]   → "מסמכים לחתימה" + מונים לפי מצב
 *   POST                               → מסמך חדש: חותם אחד או יותר (signers), או הצורה הישנה (email/phone)
 */
const Field = z.union([z.string().max(2000), z.number(), z.null()])
const Signer = z.object({
  label: z.string().min(1).max(60), name: z.string().max(200).nullish(), email: z.string().max(200).nullish(), phone: z.string().max(40).nullish(),
  requireOtp: z.boolean().optional(), fields: z.record(z.string(), Field).optional(),
})
const Create = z.object({
  clientDoc: z.string().min(1).max(200).regex(/^[^/]+$/),
  clientName: z.string().min(1).max(200),
  division: z.enum(['finance', 'realestate']),
  title: z.string().min(2).max(200),
  template: z.string().min(20).max(60000),
  category: z.enum(['agreement', 'bank', 'fund', 'insurance', 'poa', 'general']).optional(),
  templateKey: z.string().max(80).nullish(), lender: z.string().max(120).nullish(),
  fields: z.record(z.string(), Field).default({}),
  signers: z.array(Signer).min(1).max(6).optional(),
  perSigner: z.boolean().optional(),
  email: z.string().max(200).nullish(), phone: z.string().max(40).nullish(),
  expiresDays: z.number().int().min(1).max(60).nullish(),
  allowMissing: z.boolean().optional(),
})

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const client = sp.get('client')
  if (client) {
    if (client.includes('/')) return NextResponse.json({ code: 'invalid_argument', message: 'לקוח לא תקין' }, { status: 400 })
    return NextResponse.json({ envelopes: await listEnvelopes({ client, limit: 30 }) })
  }
  if (sp.get('all')) {
    const division = ['finance', 'realestate'].includes(sp.get('division') ?? '') ? sp.get('division') : null
    const [envelopes, counts] = await Promise.all([listEnvelopes({ state: sp.get('state') || null, division, limit: 500 }), envelopeCounts(division)])
    return NextResponse.json({ envelopes, counts })
  }
  return NextResponse.json({ code: 'invalid_argument', message: 'חסר לקוח' }, { status: 400 })
}

export async function POST(req: Request) {
  const parsed = Create.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: 'invalid_argument', message: 'בקשה לא תקינה: ' + parsed.error.issues.map((i) => i.path.join('.')).join(', ') }, { status: 400 })
  const d = parsed.data
  const signers = d.signers ?? [{ label: 'הלקוח', name: d.clientName, email: d.email, phone: d.phone }]
  const r = await createEnvelope({ ...d, signers }, new Date(), new URL(req.url).origin)
  if ('error' in r) return NextResponse.json({ code: r.missing.length ? 'missing_fields' : 'invalid_argument', message: r.error, missing: r.missing }, { status: 422 })
  return NextResponse.json(r)
}
