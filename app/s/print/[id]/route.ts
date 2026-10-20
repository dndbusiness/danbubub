import { checkPrintKey, envelopeById, envelopeSigners } from '@/lib/sign/store'
import { messagePage, printPage } from '@/lib/sign/pages'
import { stampDataUrl } from '@/lib/sign/stamp'

export const dynamic = 'force-dynamic'

/** המסמך החתום (כל החותמים) + עמוד התיעוד — ממנו נוצר ה-PDF. מוגן במפתח HMAC (?k=), לא בטוקן של חותם. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sp = new URL(req.url).searchParams, k = sp.get('k')
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
  if (!checkPrintKey(id, k)) return new Response(messagePage('אין גישה', '', 'bad'), { status: 403, headers })
  const env = await envelopeById(id)
  const rows = env ? (await envelopeSigners(env.id)).filter((r) => r.status === 'signed') : []
  if (!env || !rows.length) return new Response(messagePage('לא נמצא מסמך חתום', '', 'bad'), { status: 404, headers })
  // החותמת שנשמרה עם המסמך בזמן השליחה (@stamp) — לא החותמת של היום
  const stamp = await stampDataUrl(rows.map((r) => r.fields?.['@stamp']).find(Boolean))
  return new Response(printPage(env, rows, { auditOnly: sp.get('audit') === '1', stamp }), { headers })
}
