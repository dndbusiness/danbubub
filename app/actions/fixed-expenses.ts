'use server'

import { revalidatePath } from 'next/cache'
import { withActor } from '@/lib/db'

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(fd: FormData, k: string): number | null {
  const v = str(fd, k)
  if (v === null) return null
  const n = Number(v.replace(/[,\s₪]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** הוצאה קבועה חדשה — SPEC §2.1 fixed_expenses. */
export async function createFixedExpense(fd: FormData) {
  const name = str(fd, 'name'); const categoryId = str(fd, 'category_id'); const division = str(fd, 'division')
  const amount = num(fd, 'amount_net'); const day = num(fd, 'day_of_month'); const accountId = str(fd, 'account_id')
  const frequency = str(fd, 'frequency') ?? 'monthly'; const startDate = str(fd, 'start_date')
  const variable = fd.get('variable') === 'on'; const approved = fd.get('approved_by_nissim') === 'on'
  const financeSplit = num(fd, 'split_finance')
  if (!name || !categoryId || !division || amount === null || day === null || !accountId || !startDate) {
    return { ok: false as const, error: 'חסרים שדות חובה' }
  }
  const split = division === 'shared' ? JSON.stringify({ finance: financeSplit ?? 0.8, realestate: 1 - (financeSplit ?? 0.8) }) : null
  try {
    await withActor(async (tx) => {
      await tx`insert into fixed_expenses
        (name, category_id, division, division_split, amount_net, frequency, day_of_month, account_id, variable, approved_by_nissim, start_date)
        values (${name}, ${categoryId}, ${division}, ${split}::jsonb, ${-Math.abs(amount)}, ${frequency}, ${day}, ${accountId}, ${variable}, ${approved}, ${startDate})`
    })
    revalidatePath('/fixed-expenses')
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}

/** SPEC §3.3 — "הוצאה קבועה מאושרת" ל-50/50. */
export async function setApproved(id: string, approved: boolean) {
  try {
    await withActor(async (tx) => {
      await tx`update fixed_expenses
               set approved_by_nissim = ${approved},
                   approved_at = ${approved ? new Date() : null}
               where id = ${id} and deleted_at is null`
    })
    revalidatePath('/fixed-expenses')
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}

export async function setActive(id: string, active: boolean) {
  try {
    await withActor(async (tx) => {
      await tx`update fixed_expenses set active = ${active} where id = ${id} and deleted_at is null`
    })
    revalidatePath('/fixed-expenses')
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}
