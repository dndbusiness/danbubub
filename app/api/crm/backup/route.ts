import { effectiveSession } from '@/lib/crm/auth'
import { crmBackup, israelDay, recordBackupRun } from '@/lib/crm/backup'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * "גבה עכשיו" בדף כשעובדים מהשרת: גיבוי מלא של ה-CRM כקובץ להורדה (harel-crm-YYYY-MM-DD.json.gz).
 * רק דן. ההורדה = עותק מחוץ לשרת, ולכן נרשמת כגיבוי תקין (runs/drive) — ?mark=0 כדי לא לרשום.
 */
export async function GET(req: Request) {
  const s = await effectiveSession(req)
  if (s?.r !== 'owner') return Response.json({ code: 'permission_denied', message: 'רק דן' }, { status: 403 })
  const now = new Date(), day = israelDay(now)
  const b = await crmBackup(now, day)
  if (new URL(req.url).searchParams.get('mark') !== '0') await recordBackupRun({ day, at: now.toISOString(), ok: true, via: 'download', b })
  return new Response(new Uint8Array(b.gz), { headers: {
    'content-type': 'application/gzip',
    'content-disposition': `attachment; filename="${b.name}"`,
    'cache-control': 'no-store',
    'x-crm-docs': String(b.total),
  } })
}
