import { buildDailySummary, renderDailySummaryHtml } from '@/lib/reports/daily-summary'

export const dynamic = 'force-dynamic'

/** הסיכום היומי לפי דרישה מהמסך — אותה פונקציה של הג'וב (ADDENDUM הנחיה 20). גם המקור ל-PDF. */
export async function GET(_req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('date בפורמט YYYY-MM-DD', { status: 400 })
  const data = await buildDailySummary(date)
  return new Response(renderDailySummaryHtml(data, process.env.APP_BASE_URL ?? ''), { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
