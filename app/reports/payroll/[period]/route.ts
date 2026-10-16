import { buildPayrollReport, renderPayrollCsv, renderPayrollHtml } from '@/lib/reports/payroll'

export const dynamic = 'force-dynamic'

/**
 * אותו דוח שכר — במסך, ב-PDF ובמייל (הנחיה 20).
 *   /reports/payroll/2026-09         → HTML (וממנו ה-PDF)
 *   /reports/payroll/2026-09?csv=1   → CSV לאקסל של הרו"ח
 */
export async function GET(req: Request, { params }: { params: Promise<{ period: string }> }) {
  const { period } = await params
  if (!/^\d{4}-\d{2}$/.test(period)) return new Response('תקופה בפורמט YYYY-MM', { status: 400 })
  const data = await buildPayrollReport(period)

  if (new URL(req.url).searchParams.get('csv')) {
    return new Response(renderPayrollCsv(data), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="payroll-${period}.csv"`,
      },
    })
  }
  return new Response(renderPayrollHtml(data), { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
