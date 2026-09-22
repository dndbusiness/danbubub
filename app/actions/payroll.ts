'use server'

import { revalidatePath } from 'next/cache'
import { sql, withActor } from '@/lib/db'
import { isPeriodLocked, vatRateOn } from '@/lib/queries/common'
import { payrollForMonth } from '@/lib/queries/payroll'

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
 * מסך 19 — הזנת הקלט החודשי (SPEC §3.9).
 * הקלט בלבד; החישוב נעשה מההסכם שבתוקף, ולא נשמר עד האישור.
 */
export async function setPayrollInputs(employeeId: string, period: string, patch: {
  hours_worked?: number | null
  meetings_count?: number | null
  sales_count?: number | null
  leads_count?: number | null
  sales_amount_net?: number | null
}): Promise<Result> {
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, error: 'תקופה לא תקינה' }
  try {
    const blocked = await withActor(async (tx) => {
      const [existing] = await tx<{ status: string }[]>`
        select status from payroll_months where employee_id = ${employeeId} and period = ${period} and deleted_at is null`
      // §3.9 — "אין עריכה של חודש approved; תיקון = manual_adjustment בחודש הבא."
      if (existing && existing.status !== 'draft') return existing.status
      await tx`
        insert into payroll_months (employee_id, period, hours_worked, meetings_count, sales_count, leads_count, sales_amount_net)
        values (${employeeId}, ${period}, ${patch.hours_worked ?? null}, ${patch.meetings_count ?? null},
                ${patch.sales_count ?? null}, ${patch.leads_count ?? null}, ${patch.sales_amount_net ?? null})
        on conflict (employee_id, period) do update set
          hours_worked     = coalesce(${patch.hours_worked ?? null}, payroll_months.hours_worked),
          meetings_count   = coalesce(${patch.meetings_count ?? null}, payroll_months.meetings_count),
          sales_count      = coalesce(${patch.sales_count ?? null}, payroll_months.sales_count),
          leads_count      = coalesce(${patch.leads_count ?? null}, payroll_months.leads_count),
          sales_amount_net = coalesce(${patch.sales_amount_net ?? null}, payroll_months.sales_amount_net)`
      return null
    })
    if (blocked) return { ok: false, error: 'החודש כבר אושר — תיקון נעשה כהתאמה ידנית בחודש הבא (§3.9)' }
    revalidatePath('/payroll')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** §3.9 — התאמה ידנית, עם הסבר. זה גם מסלול התיקון לחודש שכבר אושר. */
export async function addPayrollAdjustment(fd: FormData): Promise<Result> {
  const employeeId = str(fd, 'employee_id')
  const period = str(fd, 'period')
  const label = str(fd, 'label')
  const amount = num(fd, 'amount')
  if (!employeeId || !period) return { ok: false, error: 'חסר עובד או חודש' }
  if (!label) return { ok: false, error: 'יש להזין על מה ההתאמה' }
  if (amount === null || amount === 0) return { ok: false, error: 'יש להזין סכום' }
  try {
    const blocked = await withActor(async (tx) => {
      const [existing] = await tx<{ status: string }[]>`
        select status from payroll_months where employee_id = ${employeeId} and period = ${period} and deleted_at is null`
      if (existing && existing.status !== 'draft') return existing.status
      const line = { label, amount, note: str(fd, 'note') ?? undefined }
      await tx`
        insert into payroll_months (employee_id, period, manual_adjustments)
        values (${employeeId}, ${period}, ${tx.json([line] as never)})
        on conflict (employee_id, period) do update set
          manual_adjustments = payroll_months.manual_adjustments || ${tx.json([line] as never)}`
      return null
    })
    if (blocked) return { ok: false, error: 'החודש כבר אושר — לא ניתן להוסיף התאמה אליו (§3.9)' }
    revalidatePath('/payroll')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/**
 * אישור — §3.9: "כל מספר ב-computed נשמר עם ההסבר".
 * מכאן ואילך המסך מציג את התצלום ולא מחשב מחדש.
 */
export async function approvePayroll(period: string, employeeId?: string): Promise<Result<{ approved: number }>> {
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, error: 'תקופה לא תקינה' }
  try {
    const lines = await payrollForMonth(period)
    const target = lines.filter((l) => l.result && (!employeeId || l.employee.id === employeeId))
    if (!target.length) return { ok: false, error: 'אין מה לאשר — חסר הסכם בתוקף או קלט' }
    const incomplete = target.filter((l) => l.missingInputs.length)
    if (incomplete.length) {
      return { ok: false, error: `חסר קלט ל-${incomplete.map((l) => l.employee.name).join(', ')}: ${[...new Set(incomplete.flatMap((l) => l.missingInputs))].join(', ')}` }
    }

    const approved = await withActor(async (tx) => {
      let n = 0
      for (const l of target) {
        if (l.month && l.month.status !== 'draft') continue
        await tx`
          insert into payroll_months (employee_id, period, computed, gross_total, employer_cost_est, status, approved_by, approved_at)
          values (${l.employee.id}, ${period}, ${tx.json(l.result as never)}, ${l.result!.grossTotal}, ${l.result!.employerCostEst},
                  'approved', current_setting('app.current_user_id', true)::uuid, now())
          on conflict (employee_id, period) do update set
            computed = ${tx.json(l.result as never)}, gross_total = ${l.result!.grossTotal},
            employer_cost_est = ${l.result!.employerCostEst}, status = 'approved',
            approved_by = current_setting('app.current_user_id', true)::uuid, approved_at = now()`
        n++
      }
      return n
    })
    revalidatePath('/payroll'); revalidatePath('/cashflow'); revalidatePath('/pnl')
    return { ok: true, approved }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** חזרה לטיוטה — רק לפני שנשלח לרו"ח. */
export async function reopenPayroll(employeeId: string, period: string): Promise<Result> {
  try {
    const blocked = await withActor(async (tx) => {
      const [m] = await tx<{ status: string }[]>`
        select status from payroll_months where employee_id = ${employeeId} and period = ${period} and deleted_at is null`
      if (!m) return 'לא נמצא'
      if (m.status === 'sent_to_accountant' || m.status === 'paid') return m.status
      await tx`
        update payroll_months set status = 'draft', approved_by = null, approved_at = null
        where employee_id = ${employeeId} and period = ${period}`
      return null
    })
    if (blocked) return { ok: false, error: blocked === 'paid' ? 'החודש כבר שולם' : blocked === 'sent_to_accountant' ? 'החודש כבר נשלח לרו"ח' : 'לא נמצא' }
    revalidatePath('/payroll')
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/**
 * סימון תשלום — יוצר את התנועה בפועל (עלות המעביד) ומקשר אותה לחודש.
 * זה החיבור של השכר ל-P&L ולתזרים (§9 שלב 8b).
 */
export async function markPayrollPaid(employeeId: string, period: string, date: string, accountId?: string): Promise<Result<{ txId: string }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'תאריך לא תקין' }
  if (await isPeriodLocked(date.slice(0, 7), 'finance')) {
    return { ok: false, error: `התקופה ${date.slice(5, 7)}/${date.slice(0, 4)} נעולה (§1.6)` }
  }
  try {
    const out = await withActor(async (tx): Promise<{ error: string } | { txId: string }> => {
      const [m] = await tx<{ id: string; status: string; employer_cost_est: number; gross_total: number; name: string; pay_type: string; division_split: Record<string, number> }[]>`
        select m.id, m.status, m.employer_cost_est, m.gross_total, e.name, e.pay_type::text, e.division_split
        from payroll_months m join employees e on e.id = m.employee_id
        where m.employee_id = ${employeeId} and m.period = ${period} and m.deleted_at is null`
      if (!m) return { error: 'לא נמצא חודש שכר' }
      if (m.status === 'draft') return { error: 'צריך לאשר את החודש לפני סימון תשלום' }
      if (m.status === 'paid') return { error: 'כבר סומן כשולם' }

      const [acc] = accountId
        ? await tx<{ id: string }[]>`select id from accounts where id = ${accountId} and deleted_at is null`
        : await tx<{ id: string }[]>`select id from accounts where type = 'bank' and active and deleted_at is null order by created_at limit 1`
      if (!acc) return { error: 'אין חשבון בנק לרשום ממנו' }

      const [cat] = await tx<{ id: string }[]>`
        select id from categories where deleted_at is null and (name ilike '%שכר%' or name ilike '%משכורת%') order by name limit 1`
      if (!cat) return { error: 'חסרה קטגוריית שכר' }

      // עלות המעביד היא מה שיוצא מהקופה (תלוש); בחשבונית — הסכום עצמו.
      const amount = Number(m.pay_type === 'payslip' ? m.employer_cost_est : m.gross_total)
      const [tx1] = await tx<{ id: string }[]>`
        insert into transactions
          (date_cash, account_id, amount_net, vat_mode, vat_rate, nature, division, division_split, category_id,
           tx_class, deductible, counterparty, description, invoice_status, review_status, source, source_ref)
        values
          (${date}, ${acc.id}, ${-Math.abs(amount)}, 'exempt', ${await vatRateOn(date)}, 'expense',
           'shared', ${tx.json(m.division_split as never)}, ${cat.id}, 'business', true,
           ${m.name}, ${`שכר ${period} — ${m.name}`}, ${m.pay_type === 'payslip' ? 'no_invoice_needed' : 'missing'},
           -- tx_source אין בו 'payroll'; התנועה נוצרה ע"י המערכת, וה-source_ref מזהה בדיוק ממה.
           'ok', 'system', ${`payroll:${employeeId}:${period}`})
        returning id`
      await tx`update payroll_months set status = 'paid', paid_tx_id = ${tx1!.id} where id = ${m.id}`
      return { txId: tx1!.id }
    })
    if ('error' in out) return { ok: false, error: out.error }
    revalidatePath('/payroll'); revalidatePath('/transactions'); revalidatePath('/cashflow')
    return { ok: true, txId: out.txId }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** עובד חדש. §1.2 — מפתח החלוקה הוא של העובד (הדס 80/20). */
export async function addEmployee(fd: FormData): Promise<Result<{ id: string }>> {
  const name = str(fd, 'name')
  const payType = str(fd, 'pay_type') ?? 'payslip'
  const startDate = str(fd, 'start_date')
  const financePct = num(fd, 'finance_pct') ?? 100
  if (!name) return { ok: false, error: 'יש להזין שם' }
  if (!startDate) return { ok: false, error: 'יש להזין תאריך תחילת עבודה' }
  if (!['payslip', 'invoice', 'freelancer'].includes(payType)) return { ok: false, error: 'סוג תשלום לא מוכר' }
  if (financePct < 0 || financePct > 100) return { ok: false, error: 'החלוקה באחוזים, בין 0 ל-100' }
  const finance = Math.round(financePct) / 100
  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into employees (name, national_id, pay_type, division_split, start_date)
        values (${name}, ${str(fd, 'national_id')}, ${payType}::pay_type,
                ${tx.json({ finance, realestate: Math.round((1 - finance) * 1000) / 1000 } as never)}, ${startDate})
        returning id`
      return row!.id
    })
    revalidatePath('/payroll')
    return { ok: true, id }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

/** §3.9 — "שינוי הסכם = שורה חדשה, לא עריכה". השורה הקודמת נסגרת יום לפני. */
export async function addEmploymentTerms(fd: FormData): Promise<Result<{ id: string }>> {
  const employeeId = str(fd, 'employee_id')
  const validFrom = str(fd, 'valid_from')
  const baseMode = str(fd, 'base_mode') ?? 'monthly'
  if (!employeeId) return { ok: false, error: 'יש לבחור עובד' }
  if (!validFrom || !/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) return { ok: false, error: 'תאריך תחילה לא תקין' }
  if (!['hourly', 'monthly', 'none'].includes(baseMode)) return { ok: false, error: 'סוג בסיס לא מוכר' }
  const hourly = num(fd, 'hourly_rate')
  const monthly = num(fd, 'monthly_base')
  if (baseMode === 'hourly' && hourly === null) return { ok: false, error: 'בסיס שעתי דורש תעריף לשעה' }
  if (baseMode === 'monthly' && monthly === null) return { ok: false, error: 'בסיס חודשי דורש סכום' }

  let components: unknown = []
  const raw = str(fd, 'components')
  if (raw) {
    try {
      components = JSON.parse(raw)
      if (!Array.isArray(components)) return { ok: false, error: 'רכיבי הבונוס חייבים להיות רשימה' }
    } catch { return { ok: false, error: 'רכיבי הבונוס אינם JSON תקין' } }
  }

  try {
    const id = await withActor(async (tx) => {
      const day = new Date(`${validFrom}T00:00:00Z`)
      day.setUTCDate(day.getUTCDate() - 1)
      await tx`
        update employment_terms set valid_to = ${day.toISOString().slice(0, 10)}
        where employee_id = ${employeeId} and deleted_at is null and valid_to is null and valid_from < ${validFrom}`
      const [row] = await tx<{ id: string }[]>`
        insert into employment_terms
          (employee_id, valid_from, base_mode, hourly_rate, monthly_base, expected_hours, components, employer_cost_pct, notes)
        values
          (${employeeId}, ${validFrom}, ${baseMode}, ${hourly}, ${monthly}, ${num(fd, 'expected_hours')},
           ${tx.json(components as never)}, ${(num(fd, 'employer_cost_pct') ?? 22) / 100}, ${str(fd, 'notes')})
        returning id`
      return row!.id
    })
    revalidatePath('/payroll')
    return { ok: true, id }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
