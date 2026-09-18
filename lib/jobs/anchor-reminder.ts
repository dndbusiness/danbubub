import { anchorReminderRow } from '@/lib/rules/notifications'
import { bankAccount, latestAnchor, settingValues } from '@/lib/queries/cashflow'
import { enqueueOutbox, flushOutbox } from './outbox'
import { runJob } from './run'

/** חלק ג' `anchor_reminder` — "08:30 יומי אם אין עוגן" → וואטסאפ. */
export async function anchorReminderJob(asOf: string): Promise<{ rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }> {
  return runJob('anchor_reminder', async () => {
    const account = await bankAccount()
    if (!account) return { rowsTouched: 0, skipped: 'אין חשבון בנק' }
    const last = await latestAnchor(account.id, asOf)
    if (last?.date === asOf) return { rowsTouched: 0, skipped: 'העוגן להיום כבר הוזן' }
    const s = await settingValues(['notify_whatsapp_dan'])
    const row = anchorReminderRow(asOf, last?.date ?? null, { whatsapp: typeof s.notify_whatsapp_dan === 'string' ? s.notify_whatsapp_dan : null }, process.env.APP_BASE_URL ?? '')
    if (!row) return { rowsTouched: 0, skipped: 'לא הוגדר יעד וואטסאפ (notify_whatsapp_dan)' }
    const queued = await enqueueOutbox([row])
    const flush = await flushOutbox()
    return { rowsTouched: queued, detail: { flush } }
  })
}
