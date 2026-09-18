'use server'

import { revalidatePath } from 'next/cache'
import { disconnectGoogle } from '@/lib/google/store'
import { dailySummaryJob } from '@/lib/jobs/daily-summary'
import { calendarSyncJob } from '@/lib/jobs/calendar-sync'
import { sql } from '@/lib/db'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export async function disconnectGoogleAction(): Promise<Result> {
  try { await disconnectGoogle(); revalidatePath('/settings'); return { ok: true } } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** "הפק עכשיו" — אותה פונקציה של הג'וב (הנחיה 20). */
export async function runDailySummaryNow(date?: string): Promise<Result<{ pdf: string | null; driveUrl: string | null; emailed: boolean; skipped?: string }>> {
  try {
    const r = await dailySummaryJob(date ?? new Date().toISOString().slice(0, 10), { force: true })
    revalidatePath('/settings')
    return { ok: true, pdf: r.pdf, driveUrl: r.driveUrl, emailed: r.emailed, skipped: r.skipped }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** מפתחות הגדרה שניתן לערוך מהמסך (ב.2 יומן, ב.3 חשבונית ירוקה, אנשים). ערכים אחרים — scripts/set-setting.mjs. */
const EDITABLE: Record<string, 'text' | 'email' | 'int' | 'bool' | 'list'> = {
  notify_email_nissim: 'email', notify_email_hadas: 'email', calendar_ids: 'list',
  payroll_pay_day: 'int', payroll_approval_day: 'int', accountant_close_day: 'int', vat_day: 'int', vat_bimonthly: 'bool',
  greeninvoice_intake_email: 'email',
}

export async function saveSettings(fd: FormData): Promise<Result> {
  try {
    for (const [key, type] of Object.entries(EDITABLE)) {
      const raw = fd.get(key)
      if (raw === null) continue
      const v = String(raw).trim()
      let value: unknown = null
      if (type === 'bool') value = fd.get(key) === 'on'
      else if (!v) value = null
      else if (type === 'int') { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 31) return { ok: false, error: `${key}: יום בין 1 ל-31` }; value = n }
      else if (type === 'list') value = v.split(',').map((x) => x.trim()).filter(Boolean)
      else if (type === 'email') { if (!/^[^@\s]+@[^@\s]+$/.test(v)) return { ok: false, error: `${key}: כתובת מייל לא תקינה` }; value = v }
      else value = v
      if (value === null) await sql`delete from settings where key = ${key}`
      else await sql`insert into settings (key, value, description) values (${key}, ${sql.json(value as never)}, 'הוגדר במסך ההגדרות') on conflict (key) do update set value = excluded.value, updated_at = now()`
    }
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

export async function runCalendarSyncNow(): Promise<Result<{ planned: number; queued: number; skipped?: string }>> {
  try {
    const r = await calendarSyncJob(new Date().toISOString().slice(0, 10))
    revalidatePath('/settings')
    return { ok: true, planned: Number(r.detail?.planned ?? 0), queued: r.rowsTouched, skipped: r.skipped }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
