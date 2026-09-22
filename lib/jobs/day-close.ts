import { sql, withActor } from '@/lib/db'
import { closeDay } from '@/lib/rules/cashflow'
import { alertThresholds, bankAccount, latestAnchor, loadCashflow, previousAnchor, recordedBetween } from '@/lib/queries/cashflow'
import { runJob } from './run'

export interface DayCloseOutcome { rowsTouched: number; skipped?: string; detail?: Record<string, unknown>; variance: number | null; unexplained: number | null; status: string | null }

/**
 * חלק ג' `day_close` (06:30 יומי) — SPEC §3.6 "צפי אתמול − עוגן היום = סטייה → תור 'מה קרה?'".
 * רץ גם מיד אחרי הזנת עוגן (מסך 1/3), כי אז יש מה לסגור.
 */
export async function dayCloseJob(asOf: string, accountId?: string): Promise<DayCloseOutcome> {
  return runJob('day_close', async () => {
    const account = accountId ? { id: accountId } : await bankAccount()
    if (!account) return { rowsTouched: 0, skipped: 'אין חשבון בנק', variance: null, unexplained: null, status: null }
    const today = await latestAnchor(account.id, asOf)
    if (!today || today.date !== asOf) return { rowsTouched: 0, skipped: `אין עוגן ל-${asOf}`, variance: null, unexplained: null, status: null }
    const prev = await previousAnchor(account.id, asOf)
    const thresholds = await alertThresholds()

    let committedBetween = 0
    if (prev) {
      // מה התזרים חזה: מריצים אותו מהעוגן הקודם ולוקחים את הפריטים הוודאיים עד היום.
      const cf = await loadCashflow(prev.date, prev)
      if (!('error' in cf)) {
        committedBetween = cf.items
          .filter((i) => i.certainty === 'committed' && i.date > prev.date && i.date <= asOf)
          .reduce((a, i) => a + i.amount, 0)
      }
    }
    const recorded = prev ? await recordedBetween(account.id, prev.date, asOf) : 0
    const r = closeDay({
      date: asOf, previousAnchor: prev?.balance ?? null, previousAnchorDate: prev?.date ?? null, actual: today.balance,
      committedBetween, recordedBetween: recorded, threshold: thresholds.dailyVarianceShekels,
    })
    await withActor(async (tx) => {
      await tx`
        insert into daily_closes (date, account_id, previous_anchor_date, previous_anchor, predicted, actual, recorded, variance, unexplained, exceeds_threshold, status)
        values (${asOf}, ${account.id}, ${prev?.date ?? null}, ${prev?.balance ?? null}, ${r.predicted}, ${r.actual}, ${r.recorded}, ${r.variance}, ${r.unexplained}, ${r.exceedsThreshold}, ${r.status})
        on conflict (account_id, date) do update
          set previous_anchor_date = excluded.previous_anchor_date, previous_anchor = excluded.previous_anchor, predicted = excluded.predicted,
              actual = excluded.actual, recorded = excluded.recorded, variance = excluded.variance, unexplained = excluded.unexplained,
              exceeds_threshold = excluded.exceeds_threshold,
              -- סגירה שכבר טופלה לא נפתחת מחדש בגלל עדכון עוגן באותו יום
              status = case when daily_closes.status in ('ok', 'open') then excluded.status else daily_closes.status end`
    })
    return { rowsTouched: 1, detail: { previousAnchorDate: prev?.date ?? null, committedBetween, recorded }, variance: r.variance, unexplained: r.unexplained, status: r.status }
  })
}

export const _sql = sql
