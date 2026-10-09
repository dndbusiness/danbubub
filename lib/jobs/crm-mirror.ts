import { gunzipSync } from 'node:zlib'
import { sql } from '@/lib/db'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { importMirror } from '@/lib/crm/store'
import { runJob } from './run'

type Out = { rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }

/** תיקיית הגיבויים בדרייב שהדף ב-Claude כותב אליה כל יום — settings.crm_mirror_folder או CRM_BACKUP_FOLDER.
 *  לא בקוד: הריפו ציבורי, ובתיקייה עותק מלא של הנתונים. */
const DRIVE_FULL = 'https://www.googleapis.com/auth/drive'

async function setting<T>(key: string): Promise<T | null> {
  const [r] = await sql<{ value: T }[]>`select value from settings where key = ${key}`
  return r ? r.value : null
}

/**
 * שלב המעבר (בקשת דן 09/10/26: "בשלב הראשון לשכפל, נעבור לגמרי אחרי שאראה שהכל עובד"):
 * מושך את הגיבוי האחרון של הדף ב-Claude מהדרייב ומעדכן את crm_docs.
 * idempotent — אותו קובץ לא נקלט פעמיים, ומסמך זהה לא נכתב שוב.
 * אחרי המעבר (settings.crm_mode = 'live') הג'וב מדלג: המערכת כאן היא המקור.
 */
export async function crmMirrorJob(_asOf: string): Promise<Out> {
  return runJob('crm_mirror', async () => {
    if ((await setting<string>('crm_mode')) === 'live') return { rowsTouched: 0, skipped: 'המעבר בוצע — המערכת על השרת היא המקור, אין שכפול' }
    const google = await googleIntegration()
    if (!hasScope(google, DRIVE_FULL)) return { rowsTouched: 0, skipped: 'גוגל לא מחובר עם הרשאת ה-CRM (Drive) — אפשר לשכפל ידנית: POST /api/crm/import' }
    const token = await googleAccessToken()
    const folder = (await setting<string>('crm_mirror_folder')) ?? process.env.CRM_BACKUP_FOLDER
    if (!folder) return { rowsTouched: 0, skipped: 'לא הוגדרה תיקיית הגיבויים (CRM_BACKUP_FOLDER)' }
    const q = encodeURIComponent(`'${folder}' in parents and name contains 'harel-crm-' and trashed = false`)
    const list = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=5&fields=files(id,name,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { authorization: `Bearer ${token}` } })
    if (!list.ok) throw new Error(`Drive ${list.status}: ${(await list.text()).slice(0, 200)}`)
    const file = ((await list.json()) as { files?: { id: string; name: string; createdTime: string }[] }).files?.find((f) => /\.json(\.gz)?$/.test(f.name))
    if (!file) return { rowsTouched: 0, skipped: 'אין קובץ גיבוי בתיקייה' }
    const last = await setting<{ fileId?: string }>('crm_mirror_last')
    if (last?.fileId === file.id) return { rowsTouched: 0, skipped: `הגיבוי האחרון (${file.name}) כבר נקלט` }
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Drive download ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const dump = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8'))
    const r = await importMirror(dump)
    await sql`update settings set value = value || ${sql.json({ fileId: file.id, file: file.name } as never)} where key = 'crm_mirror_last'`
    return { rowsTouched: r.written + r.removed, detail: { file: file.name, ...r } }
  })
}
