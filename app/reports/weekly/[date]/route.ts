import { buildWeeklyReport, renderWeeklyHtml, type Audience } from '@/lib/reports/weekly'

export const dynamic = 'force-dynamic'

/** הדוח השבועי לפי דרישה — אותה פונקציה של הג'וב (הנחיה 20). גם המקור ל-PDF. */
export async function GET(req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('date בפורמט YYYY-MM-DD', { status: 400 })
  const a = new URL(req.url).searchParams.get('audience')
  const audience: Audience = a === 'nissim' || a === 'aviv' ? a : 'dan'
  const data = await buildWeeklyReport(date, audience)
  return new Response(renderWeeklyHtml(data, process.env.APP_BASE_URL ?? ''), { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
