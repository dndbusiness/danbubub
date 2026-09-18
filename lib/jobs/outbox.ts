import { sql } from '@/lib/db'
import { nextAttemptDelayMinutes, type OutboxRow } from '@/lib/rules/notifications'
import { greenApiConfig, sendWhatsApp, type GreenApiConfig } from '@/lib/outbox/green-api'

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
  const pending = await sql<{ id: string; channel: string; target: string; body: string; attempts: number; max_attempts: number }[]>`
    select id, channel, target, body, attempts, max_attempts from outbox
    where status = 'pending' and deleted_at is null and next_attempt_at <= now()
    order by created_at limit 50`
  const out: FlushResult = { sent: 0, failed: 0, waiting: 0, noTransport: [] }
  for (const row of pending) {
    if (row.channel === 'whatsapp' && !wa) { out.waiting++; if (!out.noTransport.includes('whatsapp')) out.noTransport.push('whatsapp'); continue }
    if (row.channel !== 'whatsapp') { out.waiting++; if (!out.noTransport.includes(row.channel)) out.noTransport.push(row.channel); continue }
    try {
      const id = await sendWhatsApp(wa!, row.target, row.body, opts.fetchImpl)
      await sql`update outbox set status = 'sent', sent_at = now(), attempts = attempts + 1, payload = ${sql.json({ idMessage: id })} where id = ${row.id}`
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
