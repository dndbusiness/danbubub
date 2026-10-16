import { addLabel, ensureLabel, getAttachment, getMessage, listMessages, INTAKE_QUERY } from '@/lib/google/gmail'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { processIntakeFile } from '@/lib/intake/pipeline'
import { sql } from '@/lib/db'
import { runJob } from './run'

const ALLOWED = /\.(pdf|xlsx|xls|csv)$/i

/**
 * חלק ג' `gmail_scan` (כל 15 דק') — ADDENDUM ב.3 שלבים 1, 2, 7:
 * שאילתה + תווית "כספים/לקליטה" → כל מצורף לצינור הקליטה → תיוג "כספים/נקלט" / "כספים/נכשל".
 * כשל 3 פעמים ברצף → alerts_eval מייצר "ג'וב נכשל" (הלוג כאן). לא מוחקים, לא עונים (ב.3 "מה לא").
 */
export async function gmailScanJob(asOf: string): Promise<{ rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }> {
  return runJob('gmail_scan', async () => {
    const integ = await googleIntegration()
    if (!hasScope(integ, 'https://www.googleapis.com/auth/gmail.readonly')) return { rowsTouched: 0, skipped: 'Gmail לא מחובר (gmail.readonly)' }
    const token = await googleAccessToken()
    const canLabel = hasScope(integ, 'https://www.googleapis.com/auth/gmail.modify')
    const labels = canLabel ? { intake: await ensureLabel(token, 'כספים/לקליטה'), done: await ensureLabel(token, 'כספים/נקלט'), failed: await ensureLabel(token, 'כספים/נכשל') } : null
    const ids = new Set<string>([
      ...(await listMessages(token, INTAKE_QUERY)),
      ...(labels ? await listMessages(token, `label:${'כספים-לקליטה'} -label:${'כספים-נקלט'}`) : []),
    ])
    let created = 0, duplicates = 0, failed = 0, skippedFiles = 0
    for (const id of ids) {
      const [seen] = await sql<{ n: number }[]>`select count(*)::int as n from inbox_candidates where source = 'gmail' and source_ref like ${`${id}:%`}`
      if (seen && seen.n > 0) { duplicates++; continue }
      try {
        const m = await getMessage(token, id)
        let any = false
        for (const a of m.attachments) {
          if (!ALLOWED.test(a.fileName) || a.size > 15_000_000) { skippedFiles++; continue }
          const buf = await getAttachment(token, id, a.attachmentId)
          const r = await processIntakeFile({ source: 'gmail', sourceRef: `${id}:${a.attachmentId}`, fileName: a.fileName, buf, sender: m.from, subject: m.subject, receivedAt: m.date || undefined })
          if (r.status === 'created') { created++; any = true } else if (r.status === 'duplicate') duplicates++
        }
        if (labels && any) await addLabel(token, id, labels.done)
      } catch (e) {
        failed++
        if (labels) await addLabel(token, id, labels.failed).catch(() => {})
        await sql`
          insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
          values (${`קליטת מייל נכשלה: ${id}`}, ${asOf}, 'normal', true, ${`gmail_failed:${id}`}, ${(e as Error).message.slice(0, 500)})
          on conflict do nothing`
      }
    }
    return { rowsTouched: created, detail: { messages: ids.size, created, duplicates, failed, skippedFiles } }
  })
}
