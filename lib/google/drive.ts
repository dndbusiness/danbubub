/**
 * Drive — ADDENDUM ב.1: drive.file (רק קבצים שהמערכת יצרה). מבנה התיקיות:
 *   הר-אל / כספים / YYYY/MM / סיכום-יומי | דוח-שבועי | רווח-והפסד | התחשבנות-ניסים | שכר | דפי-בנק | חשבוניות
 */

const FOLDER = 'application/vnd.google-apps.folder'

async function api(accessToken: string, url: string, init: RequestInit, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json() as Promise<Record<string, unknown>>
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export async function findChild(accessToken: string, parentId: string | null, name: string, mimeType: string | null, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const q = [`name = '${esc(name)}'`, 'trashed = false', parentId ? `'${parentId}' in parents` : "'root' in parents", mimeType ? `mimeType = '${mimeType}'` : null].filter(Boolean).join(' and ')
  const u = new URL('https://www.googleapis.com/drive/v3/files'); u.searchParams.set('q', q); u.searchParams.set('fields', 'files(id,name)')
  const data = await api(accessToken, u.toString(), {}, fetchImpl) as { files?: { id: string }[] }
  return data.files?.[0]?.id ?? null
}

/** יוצר את שרשרת התיקיות אם חסרה ומחזיר את מזהה האחרונה. */
export async function ensureFolderPath(accessToken: string, segments: readonly string[], fetchImpl: typeof fetch = fetch): Promise<string> {
  let parent: string | null = null
  for (const name of segments) {
    const found: string | null = await findChild(accessToken, parent, name, FOLDER, fetchImpl)
    if (found) { parent = found; continue }
    const created = await api(accessToken, 'https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: parent ? [parent] : undefined }),
    }, fetchImpl) as { id: string }
    parent = created.id
  }
  return parent!
}

/** העלאה (multipart). קובץ באותו שם באותה תיקייה מתעדכן ולא מוכפל. */
export async function uploadFile(accessToken: string, folderId: string, fileName: string, mimeType: string, content: Buffer, fetchImpl: typeof fetch = fetch): Promise<{ id: string; webViewLink: string }> {
  const existing = await findChild(accessToken, folderId, fileName, null, fetchImpl)
  const boundary = `harel_${Date.now().toString(36)}`
  const meta = JSON.stringify(existing ? { name: fileName } : { name: fileName, parents: [folderId] })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    content, Buffer.from(`\r\n--${boundary}--`),
  ])
  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=multipart&fields=id,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink'
  const data = await api(accessToken, url, { method: existing ? 'PATCH' : 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: body as unknown as BodyInit }, fetchImpl) as { id: string; webViewLink?: string }
  return { id: data.id, webViewLink: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view` }
}

/** ב.1 — נתיב הדוח לפי סוג ותאריך/תקופה. */
export function reportFolder(kind: 'daily' | 'weekly' | 'pnl' | 'nissim' | 'payroll' | 'bank' | 'invoices_received' | 'invoices_issued' | 'intake' | 'backup', period: string): string[] {
  const root = ['הר-אל', 'כספים']
  if (kind === 'intake') return [...root, '00_להזנה']
  if (kind === 'backup') return [...root, 'גיבוי-DB']
  const [y, m] = [period.slice(0, 4), period.slice(5, 7)]
  const names: Record<string, string[]> = {
    daily: ['סיכום-יומי'], weekly: ['דוח-שבועי'], pnl: ['רווח-והפסד'], nissim: ['התחשבנות-ניסים'], payroll: ['שכר'], bank: ['דפי-בנק'],
    invoices_received: ['חשבוניות', 'received'], invoices_issued: ['חשבוניות', 'issued'],
  }
  return [...root, y, m, ...(names[kind] ?? [])]
}
