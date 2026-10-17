import { NextResponse } from 'next/server'
import { z } from 'zod'
import { effectiveSession } from '@/lib/crm/auth'
import { loadLibrary, readAgreements } from '@/lib/sign/library'
import { requiredFields, templateFields } from '@/lib/rules/sign'
import { AGREEMENT_FIELDS } from '@/lib/rules/agreements'

export const dynamic = 'force-dynamic'

/**
 * ספריית ההסכמים (data/agreements) — לבעלים בלבד.
 *   GET   → התבניות בקבצים + מה יקרה בטעינה (dry run): נוסף / יעודכן / ללא שינוי / דורש אישור
 *   POST  {overwrite?: string[]} → טעינה ל-settings.signLibrary. idempotent; תבנית שדן ערך/אישר/מחק
 *         נדרסת רק אם ה-key שלה ב-overwrite. כל מה שנטען מתחיל כטיוטה (לא נשלח עד "אשר נוסח").
 */
async function ownerOnly(req: Request) {
  const s = await effectiveSession(req)
  if (!s) return { error: NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 }) }
  if (s.r !== 'owner') return { error: NextResponse.json({ code: 'permission_denied', message: 'רק לבעלים' }, { status: 403 }) }
  return { s }
}

export async function GET(req: Request) {
  const a = await ownerOnly(req)
  if (a.error) return a.error
  const { templates, errors } = await readAgreements()
  const plan = await loadLibrary({ by: a.s.k, at: new Date(), dryRun: true })
  return NextResponse.json({
    templates: templates.map((t) => ({ key: t.key, version: t.version, title: t.title, category: t.category, division: t.division, products: t.products, signers: t.signers,
      source: t.source, note: t.note, fields: templateFields(t.body).map((k) => ({ key: k, label: AGREEMENT_FIELDS[k] ?? k, required: requiredFields(t.body).includes(k) })) })),
    report: plan.report, errors,
  })
}

const Load = z.object({ overwrite: z.array(z.string().max(80)).max(100).optional() })

export async function POST(req: Request) {
  const a = await ownerOnly(req)
  if (a.error) return a.error
  const p = Load.safeParse(await req.json().catch(() => ({})))
  if (!p.success) return NextResponse.json({ code: 'invalid_argument', message: 'בקשה לא תקינה' }, { status: 400 })
  const r = await loadLibrary({ by: a.s.k, at: new Date(), overwrite: p.data.overwrite })
  if (r.errors.length) return NextResponse.json({ code: 'failed_precondition', message: 'קבצי הספרייה לא תקינים: ' + r.errors.join(' · '), report: r.report }, { status: 422 })
  return NextResponse.json(r)
}
