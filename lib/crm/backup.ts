/**
 * גיבוי ה-CRM מהשרת (crm_docs) — אותו מבנה כמו הגיבוי של הדף (harel-crm-YYYY-MM-DD.json.gz),
 * ולכן משוחזר באותה דרך: scripts/crm-mirror.mjs --force או POST /api/crm/import?force=1.
 * משמש את הג'וב הלילי db_backup (חלק ג') ואת "גבה עכשיו" בדף (GET /api/crm/backup) — פונקציה אחת (הנחיה 20).
 */
import { gzipSync } from 'node:zlib'
import { sql } from '@/lib/db'
import { dumpFromDocs, type CrmDoc } from '@/lib/crm/docs.js'
import { writeDoc } from '@/lib/crm/store'

/** לא נכנסים לגיבוי: קודי כניסה (זמניים), בקשות גולמיות מוויאסנטר (השיחות עצמן כן), קבצים זמניים לתור ה-AI */
export const BACKUP_SKIP = ['loginCodes', 'vcEvents', 'aiJobFiles'] as const

export const israelDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

export interface CrmBackup { name: string; gz: Buffer; jsonBytes: number; total: number; counts: Record<string, number> }

export async function crmBackup(now: Date, day = israelDay(now)): Promise<CrmBackup> {
  const rows = await sql<{ coll: string; doc_id: string; data: CrmDoc }[]>`
    select coll, doc_id, data from crm_docs where deleted_at is null order by coll, doc_id`
  const dump = dumpFromDocs(rows, now.toISOString(), BACKUP_SKIP)
  const json = JSON.stringify(dump)
  const total = Object.values(dump.counts).reduce((a, n) => a + n, 0)
  return { name: `harel-crm-${day}.json.gz`, gz: gzipSync(Buffer.from(json, 'utf8')), jsonBytes: json.length, total, counts: dump.counts }
}

/**
 * runs/drive — הרשומה שהדף כבר מציג ("גיבוי יומי") ושבריאות המערכת בודקת.
 * הצלחה דורסת; כישלון לא מוחק הצלחה קודמת — רק מוסיף lastFail, כדי שהדף יראה מתי היה הגיבוי התקין האחרון.
 */
export async function recordBackupRun(r: { day: string; at: string; ok: boolean; via: 'nightly' | 'download'; b?: CrmBackup; driveOk?: boolean; mailOk?: boolean; mailTo?: string[]; viewUrl?: string | null; error?: string | null }): Promise<void> {
  if (!r.ok) { await writeDoc('runs/drive', 'update', { lastFail: { at: r.at, via: r.via, error: r.error ?? null } }).catch(() => {}); return }
  await writeDoc('runs/drive', 'set', {
    id: 'drive', job: 'drive', server: true, via: r.via, day: r.day, at: r.at, status: 'ok',
    counts: r.b?.counts ?? {}, jsonBytes: r.b?.jsonBytes ?? 0, bytes: r.b?.gz.length ?? 0,
    driveOk: !!r.driveOk, mailOk: !!r.mailOk, mailTo: r.mailTo ?? [], viewUrl: r.viewUrl ?? null, error: r.error ?? null,
  })
}
