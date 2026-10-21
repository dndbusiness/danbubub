import { greenApiConfig } from '@/lib/outbox/green-api'
import { openRequest } from '@/lib/sign/store'
import { messagePage, signPage } from '@/lib/sign/pages'
import { stampDataUrl } from '@/lib/sign/stamp'

export const dynamic = 'force-dynamic'

const HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }

/** הדף שהחותם פותח (ציבורי — הטוקן בקישור הוא ההרשאה). קריאה בלבד: "נפתח" נרשם מהדף עצמו. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const now = new Date()
  const r = await openRequest(token, now).catch(() => null)
  if (!r) return new Response(messagePage('הקישור לא נמצא', 'ייתכן שהקישור הועתק חלקית, או שנשלח קישור חדש במקומו. נא לפנות אלינו.', 'bad'), { status: 404, headers: HEADERS })
  const pdf = r.envelope?.pdf_fields && r.envelope.page_sizes ? { fields: r.envelope.pdf_fields, pages: r.envelope.page_sizes } : null
  const stamp = r.state === 'open' ? await stampDataUrl(r.row.fields?.['@stamp']) : null
  return new Response(signPage(r.row, r.state, token, { total: r.total, now, pdf, stamp, wa: !!greenApiConfig() }), { headers: HEADERS })
}
