'use server'

import { revalidatePath } from 'next/cache'
import { sql, withActor } from '@/lib/db'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const str = (fd: FormData, k: string) => {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
const num = (fd: FormData, k: string) => {
  const v = str(fd, k)
  if (v === null) return null
  const n = Number(v.replace(/[,\s₪%]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * מסך 9 — הכנסת פרייבט חדשה (SPEC §2.1).
 * נפרד לחלוטין מהחברה: אין כאן transactions, אין division, ואין מע"מ חברה
 * (§3.1 — "נרשם ב-private_income בלבד").
 */
export async function addPrivateIncome(fd: FormData): Promise<Result<{ id: string }>> {
  const fund = str(fd, 'fund_name')
  const amount = num(fd, 'amount_net')
  const splitDan = num(fd, 'split_dan') ?? 50
  if (!fund) return { ok: false, error: 'יש להזין שם קרן' }
  if (amount === null || amount <= 0) return { ok: false, error: 'יש להזין סכום' }
  if (splitDan < 0 || splitDan > 100) return { ok: false, error: 'החלוקה באחוזים, בין 0 ל-100' }

  const dan = Math.round(splitDan) / 100
  const received = str(fd, 'received_date')
  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into private_income
          (fund_name, deal_ref, deal_amount, pct, amount_net, vat_amount, split_dan, split_nissim,
           received_date, received_to, status, note)
        values
          (${fund}, ${str(fd, 'deal_ref')}, ${num(fd, 'deal_amount')}, ${num(fd, 'pct') !== null ? num(fd, 'pct')! / 100 : null},
           ${amount}, ${num(fd, 'vat_amount') ?? 0}, ${dan}, ${Math.round((1 - dan) * 1000) / 1000},
           ${received}, ${str(fd, 'received_to')}, ${received ? 'received' : 'expected'}, ${str(fd, 'note')})
        returning id`
      return row!.id
    })
    revalidatePath('/private')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** סימון "התקבל" — התאריך והחשבון הפרטי שאליו נכנס (§2.1). */
export async function markPrivateReceived(id: string, date: string, receivedTo?: string): Promise<Result> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'תאריך לא תקין' }
  try {
    await withActor(async (tx) => {
      await tx`
        update private_income
        set status = 'received', received_date = ${date}, received_to = coalesce(${receivedTo ?? null}, received_to)
        where id = ${id} and deleted_at is null`
    })
    revalidatePath('/private')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** חזרה ל"צפוי" — טעות סימון. */
export async function markPrivateExpected(id: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update private_income set status = 'expected', received_date = null where id = ${id} and deleted_at is null`
    })
    revalidatePath('/private')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** חלוקה שונה מ-50/50 לשורה מסוימת. האילוץ ב-DB דורש שהשניים יסתכמו ל-1. */
export async function setPrivateSplit(id: string, danPct: number): Promise<Result> {
  if (!Number.isFinite(danPct) || danPct < 0 || danPct > 100) return { ok: false, error: 'החלוקה באחוזים, בין 0 ל-100' }
  const dan = Math.round(danPct) / 100
  try {
    await withActor(async (tx) => {
      await tx`
        update private_income set split_dan = ${dan}, split_nissim = ${Math.round((1 - dan) * 1000) / 1000}
        where id = ${id} and deleted_at is null`
    })
    revalidatePath('/private')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** §11.4 — אין מחיקה פיזית. */
export async function deletePrivateIncome(id: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update private_income set deleted_at = now() where id = ${id} and deleted_at is null`
    })
    revalidatePath('/private')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** רשימת שמות הקרנות שכבר קיימות — להשלמה אוטומטית בטופס. */
export async function fundNames(): Promise<string[]> {
  const rows = await sql<{ fund_name: string }[]>`
    select distinct fund_name from private_income where deleted_at is null order by fund_name`
  return rows.map((r) => r.fund_name)
}
