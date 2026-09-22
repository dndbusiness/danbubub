import { sql } from '@/lib/db'
import { nextAttemptDelayMinutes, type OutboxRow } from '@/lib/rules/notifications'
import { greenApiConfig, sendWhatsApp, type GreenApiConfig } from '@/lib/outbox/green-api'
import { sendMail } from '@/lib/google/gmail'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { upsertEvent } from '@/lib/google/calendar'
import type { CalendarPayload } from './calendar-sync'
import { readFile } from 'node:fs/promises'

/**
 * ADDENDUM הנחיה 16 — "כל יציאה החוצה עוברת דרך outbox עם retry ולוג".
 * enqueue כותב; flush שולח. וואטסאפ דרך Green-API (SPEC §9 שלב 5). מייל — עד
 * שכבת Google (ב.1, אחרי שלב 5) נשאר pending ולא נספר כניסיון.
 */
export async function enqueueOutbox(rows: OutboxRow[], refs: { alertId?: string; taskId?: string } = {}): Promise<number> {
  let n = 0
  for (const r of rows) {
    const res = await sql`
      insert into outbox (channel, target, subject, body, dedup_key, alert_id, task_id)
      values (${r.channel}, ${r.target}, ${r.subject}, ${r.body}, ${r.dedupKey}, ${refs.alertId ?? null}, ${refs.taskId ?? null})
      on conflict (dedup_key) where dedup_key is not null and deleted_at is null do nothing`
    n += res.count
  }
  return n
}

export interface FlushResult { sent: number; failed: number; waiting: number; noTransport: string[] }

export async function flushOutbox(opts: { whatsapp?: GreenApiConfig | null; fetchImpl?: typeof fetch } = {}): Promise<FlushResult> {
  const wa = opts.whatsapp === undefined ? greenApiConfig() : opts.whatsapp
  const pending = await sql<{ id: string; channel: string; target: string; subject: string | null; body: string; payload: ({ pdfPath?: string; fileName?: string } & Partial<CalendarPayload>) | null; attempts: number; max_attempts: number }[]>`
    select id, channel, target, subject, body, payload, attempts, max_attempts from outbox
    where status = 'pending' and deleted_at is null and next_attempt_at <= now()
    order by created_at limit 50`
  const out: FlushResult = { sent: 0, failed: 0, waiting: 0, noTransport: [] }
  // מייל דרך Gmail של דן (ב.1) — רק אם מחובר עם gmail.send.
  const google = pending.some((r) => r.channel === 'email' || r.channel === 'calendar') ? await googleIntegration() : null
  const canMail = hasScope(google, 'https://www.googleapis.com/auth/gmail.send')
  const canCalendar = hasScope(google, 'https://www.googleapis.com/auth/calendar.events')
  for (const row of pending) {
    if (row.channel === 'whatsapp' && !wa) { out.waiting++; if (!out.noTransport.includes('whatsapp')) out.noTransport.push('whatsapp'); continue }
    if (row.channel === 'email' && !canMail) { out.waiting++; if (!out.noTransport.includes('email')) out.noTransport.push('email'); continue }
    if (row.channel === 'calendar' && !canCalendar) { out.waiting++; if (!out.noTransport.includes('calendar')) out.noTransport.push('calendar'); continue }
    if (row.channel !== 'whatsapp' && row.channel !== 'email' && row.channel !== 'calendar') { out.waiting++; if (!out.noTransport.includes(row.channel)) out.noTransport.push(row.channel); continue }
    try {
      let id: string
      if (row.channel === 'whatsapp') id = await sendWhatsApp(wa!, row.target, row.body, opts.fetchImpl)
      else if (row.channel === 'calendar') {
        // ב.2 — אירוע לכל יומן ברשימה (ראשי של הר-אל + אישי של דן, ב.1). upsert לפי rule_key.
        const p = row.payload as CalendarPayload
        const token = await googleAccessToken()
        const results: string[] = []
        for (const cal of p.calendarIds) results.push(`${cal}:${await upsertEvent(token, cal, p.event, p.fingerprint, opts.fetchImpl)}`)
        id = results.join(',')
      } else {
        const attachments = row.payload?.pdfPath ? [{ fileName: row.payload.fileName ?? 'report.pdf', mimeType: 'application/pdf', content: await readFile(row.payload.pdfPath) }] : []
        id = await sendMail(await googleAccessToken(), { to: row.target.split(',').map((t) => t.trim()), subject: row.subject ?? 'הר-אל', html: row.body, attachments }, opts.fetchImpl)
      }
      await sql`update outbox set status = 'sent', sent_at = now(), attempts = attempts + 1, payload = ${sql.json({ ...(row.payload ?? {}), messageId: id } as never)} where id = ${row.id}`
      out.sent++
    } catch (e) {
      const attempts = row.attempts + 1
      const dead = attempts >= row.max_attempts
      await sql`
        update outbox set attempts = ${attempts}, last_error = ${(e as Error).message}, status = ${dead ? 'failed' : 'pending'},
          next_attempt_at = now() + (${nextAttemptDelayMinutes(attempts)}::int * interval '1 minute')
        where id = ${row.id}`
      out.failed++
    }
  }
  return out
}
