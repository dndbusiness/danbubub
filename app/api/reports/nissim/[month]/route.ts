import { readFile } from 'node:fs/promises'
import { NextResponse } from 'next/server'
import { internalBaseUrl, renderPdf } from '@/lib/pdf'

/** PDF לפי דרישה — אותה פונקציה של הסגירה האוטומטית (§11.20). */
export async function GET(_req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params
  if (!/^\d{4}-\d{2}$/.test(month)) return new NextResponse('חודש לא חוקי', { status: 400 })
  try {
    const file = await renderPdf(`${internalBaseUrl()}/nissim/${month}/print`, `nissim-${month}.pdf`)
    const buf = await readFile(file)
    return new NextResponse(buf, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="nissim-${month}.pdf"` },
    })
  } catch (e) {
    return new NextResponse(`הפקת PDF נכשלה: ${(e as Error).message}`, { status: 500 })
  }
}
