import { ensureFolderPath, reportFolder } from '@/lib/google/drive'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { processIntakeFile } from '@/lib/intake/pipeline'
import { sql } from '@/lib/db'
import { runJob } from './run'

/**
 * חלק ג' `drive_intake_scan` (כל 15 דק') — ADDENDUM ב.3: "אותה זרימה בדיוק לתיקיית Drive 00_להזנה/".
 * ⚠ scope drive.file רואה רק קבצים שהאפליקציה יצרה; קבצים שדן זורק לתיקייה דורשים drive.readonly (שאלה #30).
 */
export async function driveIntakeScanJob(asOf: string): Promise<{ rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }> {
  return runJob('drive_intake_scan', async () => {
    const integ = await googleIntegration()
    if (!hasScope(integ, 'https://www.googleapis.com/auth/drive.file') && !hasScope(integ, 'https://www.googleapis.com/auth/drive.readonly')) return { rowsTouched: 0, skipped: 'Drive לא מחובר' }
    const token = await googleAccessToken()
    const folder = await ensureFolderPath(token, reportFolder('intake', ''))
    const u = new URL('https://www.googleapis.com/drive/v3/files')
    u.searchParams.set('q', `'${folder}' in parents and trashed = false`)
    u.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,size)')
    const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Drive list ${res.status}`)
    const files = ((await res.json()) as { files?: { id: string; name: string; mimeType: string; modifiedTime: string; size?: string }[] }).files ?? []
    let created = 0, duplicates = 0, failed = 0
    for (const f of files) {
      if (!/\.(pdf|xlsx|xls|csv|jpg|jpeg|png)$/i.test(f.name)) continue
      const [seen] = await sql<{ n: number }[]>`select count(*)::int as n from inbox_candidates where source = 'drive' and source_ref = ${f.id}`
      if (seen && seen.n > 0) { duplicates++; continue }
      try {
        const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { headers: { authorization: `Bearer ${token}` } })
        if (!dl.ok) throw new Error(`Drive download ${dl.status}`)
        const r = await processIntakeFile({ source: 'drive', sourceRef: f.id, fileName: f.name, buf: Buffer.from(await dl.arrayBuffer()), receivedAt: f.modifiedTime })
        if (r.status === 'created') created++; else duplicates++
      } catch (e) {
        failed++
        await sql`insert into tasks (title, due_date, priority, auto_generated, auto_key, notes) values (${`קליטה מדרייב נכשלה: ${f.name}`}, ${asOf}, 'normal', true, ${`drive_failed:${f.id}`}, ${(e as Error).message.slice(0, 500)}) on conflict do nothing`
      }
    }
    return { rowsTouched: created, detail: { files: files.length, created, duplicates, failed } }
  })
}
