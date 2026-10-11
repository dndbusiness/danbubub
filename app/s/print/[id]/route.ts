import { byId, checkPrintKey } from '@/lib/sign/store'
import { messagePage, printPage } from '@/lib/sign/pages'

export const dynamic = 'force-dynamic'

/** ההסכם החתום + עמוד התיעוד — ממנו נוצר ה-PDF. מוגן במפתח HMAC (?k=), לא בטוקן של הלקוח. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const k = new URL(req.url).searchParams.get('k')
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
  if (!checkPrintKey(id, k)) return new Response(messagePage('אין גישה', '', 'bad'), { status: 403, headers })
  const row = await byId(id)
  if (!row || row.status !== 'signed') return new Response(messagePage('לא נמצא הסכם חתום', '', 'bad'), { status: 404, headers })
  return new Response(printPage(row), { headers })
}
