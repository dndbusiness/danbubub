'use server'

import { revalidatePath } from 'next/cache'
import { sql, withActor } from '@/lib/db'
import { isPeriodLocked } from '@/lib/queries/common'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const str = (fd: FormData, k: string) => {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
const num = (fd: FormData, k: string) => {
  const v = str(fd, k)
  if (v === null) return null
  const n = Number(v.replace(/[,\s₪]/g, ''))
  return Number.isFinite(n) ? n : null
}

const DRAW_TYPES = ['salary', 'management_fee', 'dividend', 'loan_repayment', 'owner_loan'] as const
type DrawType = (typeof DRAW_TYPES)[number]

/**
 * מסך 8 — רישום משיכה / הלוואת בעלים / החזר (SPEC §3.5).
 * המשיכה עצמה אינה תנועה בבנק: התנועה נרשמת בנפרד ומשויכת דרך tx_id.
 * יוני מקבל תלוש — ולכן `includes_employer_cost` הוא מה שנספר כמשיכה.
 */
export async function addPartnerDraw(fd: FormData): Promise<Result<{ id: string }>> {
  const partnerId = str(fd, 'partner_id')
  const date = str(fd, 'date')
  const amount = num(fd, 'amount')
  const type = str(fd, 'type') as DrawType | null
  const note = str(fd, 'note')
  const includesEmployerCost = fd.get('includes_employer_cost') === 'on'

  if (!partnerId) return { ok: false, error: 'יש לבחור שותף' }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'תאריך לא תקין' }
  if (amount === null || amount === 0) return { ok: false, error: 'יש להזין סכום' }
  if (!type || !DRAW_TYPES.includes(type)) return { ok: false, error: 'סוג לא מוכר' }

  // §1.6 — תקופה נעולה נדחית גם כאן, לא רק בתנועות.
  if (await isPeriodLocked(date.slice(0, 7), 'realestate')) {
    return { ok: false, error: `התקופה ${date.slice(5, 7)}/${date.slice(0, 4)} נעולה — לא ניתן לרשום משיכה (SPEC §1.6)` }
  }

  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into partner_draws (date, partner_id, amount, type, includes_employer_cost, note)
        values (${date}, ${partnerId}, ${Math.abs(amount)}, ${type}, ${includesEmployerCost}, ${note})
        returning id`
      return row!.id
    })
    revalidatePath('/partners')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** ביטול שורה — soft delete בלבד (§11.4). */
export async function deletePartnerDraw(id: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update partner_draws set deleted_at = now() where id = ${id} and deleted_at is null`
    })
    revalidatePath('/partners')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * §3.5 — יתרת פתיחה של הלוואת משקיע (יוני: 200,000 לפי האפיון).
 * המערכת לא כותבת את המספר הזה לעצמה — דן מזין אותו כאן (שאלה פתוחה #8).
 */
export async function setInvestorLoanOpening(partnerId: string, amount: number, note?: string): Promise<Result> {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'סכום לא תקין' }
  try {
    await withActor(async (tx) => {
      await tx`
        update partners set investor_loan_opening = ${amount}, investor_loan_note = ${note ?? null}
        where id = ${partnerId} and deleted_at is null`
    })
    revalidatePath('/partners')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
