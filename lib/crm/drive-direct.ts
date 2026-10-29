/**
 * קבצים בין הדפדפן לגוגל דרייב בלי לעבור בגוף הבקשה של Vercel (דן 29/10: "העלאה לא עובדת", "לא נטען").
 * פונקציה ב-Vercel מקבלת עד 4.5MB לבקשה — סריקה של 3.5MB הופכת ל-4.7MB ב-base64 ונופלת בשקט.
 *   העלאה: השרת פותח session של העלאה נמשכת (resumable) עם ה-OAuth שלו, והדפדפן שולח את הקובץ ישר לכתובת שחזרה.
 *          Origin של הדף נשלח בפתיחה — כך גוגל מאשר CORS ל-PUT מהדפדפן.
 *   הורדה: השרת מזרים את הקובץ מגוגל (stream), בלי לטעון אותו לזיכרון ובלי base64.
 */
type F = typeof fetch
const DRIVE = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,size,mimeType'

export class DriveDirectError extends Error { constructor(public code: string, message: string) { super(message) } }
const fail = (status: number, text: string) => new DriveDirectError(status === 401 || status === 403 ? 'not_granted' : status === 404 ? 'not_found' : 'tool_error', `Drive ${status}: ${text.slice(0, 200)}`)

export interface UploadReq { title: string; mimeType?: string; parentId?: string | null; size?: number }

/** פותח העלאה נמשכת ומחזיר את כתובת ה-session (Location). הקובץ עצמו לא עובר כאן. */
export async function uploadSession(token: string, req: UploadReq, origin: string | null, fetchImpl: F = fetch): Promise<string> {
  const title = String(req.title ?? '').trim().slice(0, 500) || 'ללא שם'
  const meta: Record<string, unknown> = { name: title }
  if (req.parentId) { if (!/^[\w-]{10,200}$/.test(req.parentId)) throw new DriveDirectError('invalid_argument', 'parentId לא תקין'); meta.parents = [req.parentId] }
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': req.mimeType || 'application/octet-stream' }
  if (req.size && Number.isFinite(req.size) && req.size > 0) headers['x-upload-content-length'] = String(Math.round(req.size))
  if (origin) headers.origin = origin
  const res = await fetchImpl(UPLOAD, { method: 'POST', headers, body: JSON.stringify(meta) })
  if (!res.ok) throw fail(res.status, await res.text().catch(() => ''))
  const loc = res.headers.get('location')
  if (!loc || !/^https:\/\/www\.googleapis\.com\/upload\/drive\//.test(loc)) throw new DriveDirectError('tool_error', 'Drive: לא חזרה כתובת העלאה')
  return loc
}

/** הקובץ כזרם (ומסמך של גוגל — מיוצא, ברירת מחדל PDF). */
export async function fileStream(token: string, fileId: string, exportMimeType: string | null, fetchImpl: F = fetch): Promise<{ body: ReadableStream<Uint8Array> | null; mimeType: string; name: string }> {
  if (!/^[\w-]{10,200}$/.test(fileId)) throw new DriveDirectError('invalid_argument', 'fileId לא תקין')
  const auth = { authorization: `Bearer ${token}` }
  const m = await fetchImpl(`${DRIVE}/${fileId}?fields=id,name,mimeType&supportsAllDrives=true`, { headers: auth })
  if (!m.ok) throw fail(m.status, await m.text().catch(() => ''))
  const meta = await m.json() as { name: string; mimeType: string }
  const native = meta.mimeType.startsWith('application/vnd.google-apps.')
  const exp = exportMimeType || 'application/pdf'
  const url = native ? `${DRIVE}/${fileId}/export?mimeType=${encodeURIComponent(exp)}` : `${DRIVE}/${fileId}?alt=media&supportsAllDrives=true`
  const res = await fetchImpl(url, { headers: auth })
  if (!res.ok) throw fail(res.status, await res.text().catch(() => ''))
  return { body: res.body, mimeType: native ? exp : meta.mimeType, name: meta.name }
}
