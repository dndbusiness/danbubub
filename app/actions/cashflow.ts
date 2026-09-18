'use server'

import { revalidatePath } from 'next/cache'
import { sql, withActor } from '@/lib/db'
import { bankAccount } from '@/lib/queries/cashflow'
import { dayCloseJob } from '@/lib/jobs/day-close'
import { alertsEvalJob } from '@/lib/jobs/alerts-eval'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

function num(fd: FormData, k: string): number | null {
  const v = fd.get(k)
  if (typeof v !== 'string' || !v.trim()) return null
  const n = Number(v.replace(/[,\s₪]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * העוגן היומי — SPEC §3.6, מסכים 1 ו-3, UIUX §6 ("עוגן יומי: פתיחה → הקלדה + שמור").
 * upsert ל-balances (עוגן אחד ליום), ואז סגירת יום + הערכת התראות מיד —
 * חלק ג': `alerts_eval` רץ "אחרי כל ייבוא"; עוגן חדש הוא הקלט העיקרי שלו.
 */
export async function setAnchor(fd: FormData): Promise<Result<{ date: string; variance: number | null; newAlerts: number }>> {
  const balance = num(fd, 'balance')
  const availableCredit = num(fd, 'available_credit')
  const dateRaw = fd.get('date')
  const date = typeof dateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : new Date().toISOString().slice(0, 10)
  if (balance === null) return { ok: false, error: 'יש להזין יתרה' }
  if (date > new Date().toISOString().slice(0, 10)) return { ok: false, error: 'עוגן לא יכול להיות בעתיד' }
  const account = await bankAccount()
  if (!account) return { ok: false, error: 'אין חשבון בנק פעיל' }
  try {
    await withActor(async (tx) => {
      await tx`
        insert into balances (date, account_id, balance, available_credit, source, entered_by)
        values (${date}, ${account.id}, ${balance}, ${availableCredit}, 'manual', current_setting('app.current_user_id', true)::uuid)
        on conflict (account_id, date) do update
          set balance = excluded.balance, available_credit = excluded.available_credit, entered_by = excluded.entered_by, updated_at = now()`
    })
    const close = await dayCloseJob(date, account.id)
    const alerts = await alertsEvalJob(date)
    revalidatePath('/'); revalidatePath('/cashflow'); revalidatePath('/anchor'); revalidatePath('/alerts')
    return { ok: true, date, variance: close.variance, newAlerts: alerts.created }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** תור "מה קרה?" — UIUX §5.4 טאב סטיות: סווג / הוצאה קבועה חדשה / התעלם. */
export async function resolveDailyClose(id: string, resolution: { status: 'classified' | 'fixed_expense' | 'ignored'; note?: string; txId?: string; fixedExpenseId?: string }): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`
        update daily_closes set status = ${resolution.status}, note = ${resolution.note ?? null},
          resolution_tx_id = ${resolution.txId ?? null}, resolution_fixed_id = ${resolution.fixedExpenseId ?? null}
        where id = ${id} and deleted_at is null`
    })
    revalidatePath('/cashflow'); revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** ADDENDUM ב.11 — snooze / resolved_at. */
export async function alertAction(id: string, action: 'snooze' | 'resolve', opts: { days?: number; note?: string } = {}): Promise<Result> {
  try {
    await withActor(async (tx) => {
      if (action === 'snooze') await tx`update alerts set snoozed_until = current_date + ${opts.days ?? 3}::int where id = ${id} and deleted_at is null`
      else await tx`update alerts set resolved_at = now(), resolved_note = ${opts.note ?? 'נסגר ידנית'} where id = ${id} and deleted_at is null`
    })
    revalidatePath('/alerts'); revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** הרצה ידנית של הערכת ההתראות מהמסך (חלק ג': גם "אחרי כל ייבוא"). */
export async function runAlertsNow(): Promise<Result<{ created: number; resolved: number }>> {
  try {
    const r = await alertsEvalJob(new Date().toISOString().slice(0, 10))
    revalidatePath('/alerts'); revalidatePath('/')
    return { ok: true, created: r.created, resolved: r.resolved }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function setDeliveryTargets(fd: FormData): Promise<Result> {
  const wa = String(fd.get('notify_whatsapp_dan') ?? '').replace(/\D/g, '')
  const email = String(fd.get('notify_email_dan') ?? '').trim()
  if (wa && wa.length < 11) return { ok: false, error: 'מספר וואטסאפ בפורמט בינלאומי, למשל 972501234567' }
  try {
    for (const [key, value] of [['notify_whatsapp_dan', wa || null], ['notify_email_dan', email || null]] as const) {
      if (value === null) await sql`delete from settings where key = ${key}`
      else await sql`insert into settings (key, value, description) values (${key}, ${sql.json(value as never)}, 'ADDENDUM ב.11 — יעד מסירה') on conflict (key) do update set value = excluded.value, updated_at = now()`
    }
    revalidatePath('/alerts')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
