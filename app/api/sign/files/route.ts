import { NextResponse } from 'next/server'
import { storeFile } from '@/lib/files'
import { validateUploads } from '@/lib/rules/sign-pdf'
import { mergePdfs, PdfInputError } from '@/lib/sign/pdf'
import { templateForFile } from '@/lib/sign/templates'
import { createHash } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * העלאת טופס לחתימה (מאחורי שער הכניסה): עד 5 קבצי PDF → מסמך אחד במסד (stored_files).
 * מחזיר את המזהה ומידות העמודים — לעורך השדות. multipart, שדה "file" (כמה פעמים, לפי הסדר).
 * known — אם הקובץ זהה לטופס שכבר בספרייה: השדות שכבר הוצבו עליו ("המערכת לומדת כל מסמך", דן 18/10).
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ code: 'invalid_argument', message: 'לא התקבלו קבצים' }, { status: 400 })
  const files: { name: string; bytes: Uint8Array }[] = []
  for (const v of form.getAll('file')) if (typeof v !== 'string') files.push({ name: v.name || 'מסמך.pdf', bytes: new Uint8Array(await v.arrayBuffer()) })
  const errs = validateUploads(files.map((f) => ({ name: f.name, size: f.bytes.length, head: Buffer.from(f.bytes.subarray(0, 8)).toString('latin1') })))
  if (errs.length) return NextResponse.json({ code: 'invalid_argument', message: errs.join(' · ') }, { status: 422 })
  try {
    const merged = await mergePdfs(files)
    const name = String(form.get('name') || files[0]!.name).replace(/\.pdf$/i, '').slice(0, 150) + '.pdf'
    const fileId = await storeFile(merged.bytes, name, 'application/pdf', 'sign-source')
    const known = await templateForFile(createHash('sha256').update(Buffer.from(merged.bytes)).digest('hex'), String(form.get('viewer') || '') || null).catch(() => null)
    return NextResponse.json({ fileId, pages: merged.pages, name, files: files.length, known })
  } catch (e) {
    if (e instanceof PdfInputError) return NextResponse.json({ code: 'invalid_argument', message: e.message }, { status: 422 })
    throw e
  }
}
