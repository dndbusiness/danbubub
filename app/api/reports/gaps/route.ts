import { buildGapsReport, renderGapsHtml } from '@/lib/reports/gaps'

export const dynamic = 'force-dynamic'

/** דוח הפערים לפי דרישה — אותה פונקציה של השליחה לרו"ח (הנחיה 20). גם המקור ל-PDF. */
export async function GET() {
  const data = await buildGapsReport()
  return new Response(renderGapsHtml(data, process.env.APP_BASE_URL ?? ''), { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
