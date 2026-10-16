/**
 * קבצים שצריכים לשרוד את הבקשה (017_stored_files.sql): PDF חתום, דוחות שיוצאים במייל, קבצי קליטה.
 * בשרת מנוהל הדיסק זמני — מה שנכתב לנתיב מקומי בבקשה אחת לא קיים בבקשה הבאה.
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { sql } from '@/lib/db'

export interface StoredFile { id: string; name: string; mime: string; bytes: Buffer }

export async function storeFile(bytes: Buffer | Uint8Array, name: string, mime: string, kind = 'file'): Promise<string> {
  const buf = Buffer.from(bytes)
  const [r] = await sql<{ id: string }[]>`
    insert into stored_files (name, mime, bytes, sha256, kind)
    values (${name.slice(0, 300)}, ${mime}, ${buf}, ${createHash('sha256').update(buf).digest('hex')}, ${kind})
    returning id`
  if (!r) throw new Error('שמירת הקובץ נכשלה')
  return r.id
}

/** אותו קובץ מקומי (אותו נתיב, גודל וזמן שינוי) נשמר פעם אחת בתהליך — הדוח וקישור המייל שלו חולקים מזהה. */
const stored = new Map<string, string>()
export async function storeLocalFile(path: string, name: string, mime: string, kind = 'file'): Promise<string> {
  const st = await stat(path)
  const key = `${path}|${st.size}|${st.mtimeMs}`
  const hit = stored.get(key)
  if (hit) return hit
  const id = await storeFile(await readFile(path), name, mime, kind)
  stored.set(key, id)
  return id
}

/** PDF מקומי → קישור קבוע (/api/files/<id>) שעובד גם כשהדיסק זמני. */
export async function durablePdfRef(path: string | null): Promise<string | null> {
  if (!path) return null
  return storedFileUrl(await storeLocalFile(path, basename(path), 'application/pdf', 'report'))
}

export async function readStoredFile(id: string): Promise<StoredFile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [r] = await sql<{ id: string; name: string; mime: string; bytes: Buffer }[]>`
    select id, name, mime, bytes from stored_files where id = ${id} and deleted_at is null`
  return r ? { ...r, bytes: Buffer.from(r.bytes) } : null
}

/** קישור קבוע לקובץ במסד — מה שנרשם ב-report_runs כשהדוח לא עלה לדרייב. */
export const storedFileUrl = (id: string) => `/api/files/${id}`
export const storedFileIdFromUrl = (u: string | null | undefined) => String(u ?? '').match(/^\/api\/files\/([0-9a-f-]{36})$/i)?.[1] ?? null
