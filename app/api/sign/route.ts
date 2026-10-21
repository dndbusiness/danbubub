import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createEnvelope, envelopeCounts, listEnvelopes } from '@/lib/sign/store'
import { cleanField, fieldsForSigners, signersNeeded, type PdfField } from '@/lib/rules/sign-pdf'
import { bundleTemplates, getTemplate, templateKey } from '@/lib/sign/templates'
import { readStoredFile, storeFile } from '@/lib/files'
import { mergePdfs } from '@/lib/sign/pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * מערכת החתימות — צד הצוות (מאחורי שער הכניסה, middleware). הדף של החותם: /s/<token>.
 *   GET  ?client=<doc>                 → המסמכים של הלקוח (v_sign_overview)
 *   GET  ?all=1[&state=][&division=]   → "מסמכים לחתימה" + מונים לפי מצב
 *   POST                               → מסמך חדש: חותם אחד או יותר (signers), או הצורה הישנה (email/phone)
 *        נוסח מוקלד (template) · או טופס PDF: pdfTemplateId (מהספרייה) / pdf {fileId, fields} (מסמך מזדמן)
 *        recipientKind: 'lead' — מתעניין (המסמך נרשם ביומן הליד)
 */
const Field = z.union([z.string().max(2000), z.number(), z.null()])
const Signer = z.object({
  label: z.string().min(1).max(60), name: z.string().max(200).nullish(), email: z.string().max(200).nullish(), phone: z.string().max(40).nullish(),
  requireOtp: z.boolean().optional(), fields: z.record(z.string(), Field).optional(),
  // מה שמולא מכרטיס הלקוח (שם, ת"ז, שדות טקסט בטופס) — הצעה שהחותם רואה ויכול לתקן
  prefill: z.object({ name: z.string().max(200).nullish(), idNumber: z.string().max(20).nullish(), values: z.record(z.string(), z.string().max(400)).optional() }).optional(),
})
const Create = z.object({
  clientDoc: z.string().min(1).max(200).regex(/^[^/]+$/),
  clientName: z.string().min(1).max(200),
  division: z.enum(['finance', 'realestate']),
  title: z.string().min(2).max(200),
  template: z.string().min(20).max(60000).optional(),
  pdfTemplateId: z.string().uuid().optional(),
  // כמה טפסים מהספרייה כמסמך אחד — קישור אחד לכל חותם על כולם (כמו סימון כמה תבניות ב-WISE)
  pdfTemplateIds: z.array(z.string().uuid()).min(2).max(10).optional(),
  pdf: z.object({ fileId: z.string().uuid(), fields: z.array(z.unknown()).max(300) }).optional(),
  recipientKind: z.enum(['client', 'lead']).optional(),
  category: z.enum(['agreement', 'bank', 'fund', 'insurance', 'poa', 'general']).optional(),
  templateKey: z.string().max(80).nullish(), lender: z.string().max(120).nullish(),
  fields: z.record(z.string(), Field).default({}),
  signers: z.array(Signer).min(1).max(6).optional(),
  perSigner: z.boolean().optional(),
  email: z.string().max(200).nullish(), phone: z.string().max(40).nullish(),
  expiresDays: z.number().int().min(1).max(60).nullish(),
  allowMissing: z.boolean().optional(),
  notes: z.string().max(4000).nullish(),
  sentBy: z.string().max(80).nullish(),
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
  let pdf: { fileId: string; fields: PdfField[]; templateId?: string | null } | null = null
  let templateKeyV = d.templateKey ?? null, requireOtp = false
  if (d.pdfTemplateIds) {
    const b = await bundleTemplates(d.pdfTemplateIds, async (id) => (await readStoredFile(id))?.bytes ?? null, mergePdfs)
    if ('error' in b) return NextResponse.json({ code: 'not_found', message: b.error }, { status: 404 })
    const fileId = await storeFile(b.bytes, d.title.slice(0, 140) + '.pdf', 'application/pdf', 'sign-source')
    pdf = { fileId, fields: b.fields, templateId: null }
    templateKeyV = 'pdfs:' + d.pdfTemplateIds.join(',').slice(0, 74); requireOtp = b.requireOtp
  } else if (d.pdfTemplateId) {
    const t = await getTemplate(d.pdfTemplateId)
    if (!t) return NextResponse.json({ code: 'not_found', message: 'התבנית לא נמצאה' }, { status: 404 })
    pdf = { fileId: t.file_id, fields: t.fields, templateId: t.id }
    templateKeyV = templateKey(t.id); requireOtp = t.require_otp
  } else if (d.pdf) {
    const fields = d.pdf.fields.map(cleanField)
    if (fields.some((f) => !f)) return NextResponse.json({ code: 'invalid_argument', message: 'שדה לא תקין במסמך' }, { status: 400 })
    pdf = { fileId: d.pdf.fileId, fields: fields as PdfField[] }
  } else if (!d.template) return NextResponse.json({ code: 'invalid_argument', message: 'חסר נוסח או מסמך PDF' }, { status: 400 })
  // טופס לשני לווים ולקוח עם לווה אחד — השדות של הלווה שלא נשלח לו נשארים ריקים
  if (pdf && signers.length < signersNeeded(pdf.fields)) pdf = { ...pdf, fields: fieldsForSigners(pdf.fields, signers.length) }
  const r = await createEnvelope({ ...d, template: d.template ?? '', templateKey: templateKeyV, pdf,
    signers: requireOtp ? signers.map((s) => ({ ...s, requireOtp: s.requireOtp ?? true })) : signers }, new Date(), new URL(req.url).origin)
  if ('error' in r) return NextResponse.json({ code: r.missing.length ? 'missing_fields' : 'invalid_argument', message: r.error, missing: r.missing }, { status: 422 })
  return NextResponse.json(r)
}
