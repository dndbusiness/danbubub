'use server'

import { revalidatePath } from 'next/cache'
import { withActor } from '@/lib/db'

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

/**
 * מסך 14 — "ייבוא מ-WISE + **השלמת עלויות**" (SPEC §5).
 * העלות היא תנועה בפועל ולא מספר ידני (נספח ב, ליקוי #6): כשיש tx_id הוא נשמר.
 */
export async function addLeadCost(fd: FormData): Promise<Result<{ id: string }>> {
  const sourceId = str(fd, 'source_id')
  const date = str(fd, 'date')
  const amount = num(fd, 'amount')
  if (!sourceId) return { ok: false, error: 'יש לבחור ערוץ' }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'תאריך לא תקין' }
  if (amount === null || amount === 0) return { ok: false, error: 'יש להזין סכום' }

  // חבילה שנפרסת: "200 ₪/ליד ב-2.5 חודשים" → שורות שבועיות, כדי שה-CAC לא יקפוץ.
  const weeks = Math.max(1, Math.min(52, Math.round(num(fd, 'spread_weeks') ?? 1)))
  const per = Math.round((Math.abs(amount) / weeks) * 100) / 100

  try {
    const id = await withActor(async (tx) => {
      let first = ''
      for (let i = 0; i < weeks; i++) {
        const d = new Date(`${date}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() + i * 7)
        const [row] = await tx<{ id: string }[]>`
          insert into lead_costs (date, source_id, amount, note)
          values (${d.toISOString().slice(0, 10)}, ${sourceId}, ${per},
                  ${weeks > 1 ? `${str(fd, 'note') ?? 'חבילה'} — שבוע ${i + 1}/${weeks}` : str(fd, 'note')})
          returning id`
        if (!first) first = row!.id
      }
      return first
    })
    revalidatePath('/leads')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** §11.4 — אין מחיקה פיזית. */
export async function deleteLeadCost(id: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update lead_costs set deleted_at = now() where id = ${id} and deleted_at is null`
    })
    revalidatePath('/leads')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** §4.5 — "ניתן לתקן ידנית ומייצר כלל": תיקון הערוץ של ליד שזוהה לא נכון. */
export async function setLeadSource(leadId: string, sourceId: string): Promise<Result> {
  try {
    await withActor(async (tx) => {
      await tx`update leads set source_id = ${sourceId} where id = ${leadId} and deleted_at is null`
    })
    revalidatePath('/leads')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** ערוץ חדש — תצורה, לא נתון כספי. */
export async function addLeadSource(fd: FormData): Promise<Result<{ id: string }>> {
  const name = str(fd, 'name')
  const costModel = str(fd, 'cost_model') ?? 'per_lead'
  if (!name) return { ok: false, error: 'יש להזין שם' }
  if (!['per_lead', 'monthly', 'pct'].includes(costModel)) return { ok: false, error: 'מודל עלות לא מוכר' }
  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into lead_sources (name, cost_model, unit_cost)
        values (${name}, ${costModel}, ${num(fd, 'unit_cost')})
        returning id`
      return row!.id
    })
    revalidatePath('/leads')
    return { ok: true, id }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
