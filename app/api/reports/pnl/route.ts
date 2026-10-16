import { readFile } from 'node:fs/promises'
import { NextResponse } from 'next/server'
import { internalBaseUrl, renderPdf } from '@/lib/pdf'

export async function GET(req: Request) {
  const u = new URL(req.url)
  const period = u.searchParams.get('period') ?? ''
  if (!/^\d{4}-\d{2}$/.test(period)) return new NextResponse('חודש לא חוקי', { status: 400 })
  const division = u.searchParams.get('division') === 'realestate' ? 'realestate' : 'finance'
  const mode = u.searchParams.get('mode') === 'operational' ? 'operational' : 'distributable'
  try {
    const file = await renderPdf(`${internalBaseUrl()}/pnl/print?period=${period}&division=${division}&mode=${mode}`, `pnl-${division}-${mode}-${period}.pdf`)
    return new NextResponse(await readFile(file), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="pnl-${period}.pdf"` } })
  } catch (e) {
    return new NextResponse(`הפקת PDF נכשלה: ${(e as Error).message}`, { status: 500 })
  }
}
