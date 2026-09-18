'use server'

import { revalidatePath } from 'next/cache'
import { sql, withActor, ACTOR_ID } from '@/lib/db'
import { closingBlockers, nissimCardFor, nissimDrill } from '@/lib/queries/nissim'
import { internalBaseUrl, renderPdf } from '@/lib/pdf'
import { addMonths } from '@/lib/rules/period.js'

/**
 * סגירת חודש — SPEC §3.3 "תהליך הסגירה במסך":
 *   1. תצוגה מקדימה (במסך)
 *   2. חריגים חוסמים — כאן, שוב, בצד השרת
 *   3. אישור → periods.status=closed + snapshot + PDF + משימה "להעביר X ₪ עד ה-10"
 * SPEC §1.6: אחרי הסגירה התקופה נעולה ב-DB (trigger). תיקון = תנועת תיקון בתקופה הפתוחה.
 */
export async function closeFinancePeriod(month: string): Promise<{ ok: true; pdf: string | null } | { ok: false; error: string; blockers?: string[] }> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: 'חודש לא חוקי' }
  const [y, m] = month.split('-').map(Number) as [number, number]

  const blockers = await closingBlockers(month)
  if (blockers.length) return { ok: false, error: 'יש חריגים שחוסמים סגירה', blockers: blockers.map((b) => b.label) }

  const card = await nissimCardFor(month)
  if (!card) return { ok: false, error: 'אין נתונים לחודש זה' }
  const drill = await nissimDrill(month)

  // SPEC §2.1 periods.snapshot_json — "תצלום כל המספרים ברגע הסגירה — לא מחושב מחדש אחר כך"
  const snapshot = {
    closed_at: new Date().toISOString(),
    card,
    drill: Object.fromEntries(Object.entries(drill).map(([k, rows]) => [k, rows.map((r) => r.id)])),
  }

  try {
    await withActor(async (tx) => {
      await tx`
        insert into periods (division, year, month, status, closed_at, closed_by, snapshot_json)
        values ('finance', ${y}, ${m}, 'closed', now(), ${ACTOR_ID}, ${tx.json(JSON.parse(JSON.stringify(snapshot)))})
        on conflict (division, year, month) do update
          set status = 'closed', closed_at = now(), closed_by = ${ACTOR_ID}, snapshot_json = excluded.snapshot_json
          where periods.status = 'open'`
      // משימה: "להעביר X ₪ עד ה-10" (SPEC §3.3 שלב 3). rule_key → פעם אחת.
      if (card.line8_transfer_due > 0) {
        const next = addMonths(month, 1)
        await tx`
          insert into tasks (title, due_date, priority, auto_generated, auto_key, notes, period_id)
          values (${`להעביר ${card.line8_transfer_due.toLocaleString('he-IL')} ₪ לניסים עד ה-10`}, ${`${next}-10`}, 'high', true,
                  ${`settlement_transfer:${month}`}, ${`התחשבנות ${m}/${y}: החברה חייבת לניסים`},
                  (select id from periods where division = 'finance' and year = ${y} and month = ${m}))
          on conflict do nothing`
      }
    })
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  // PDF "דוח התחשבנות M/YYYY" (SPEC §7) — אותו HTML של מסך ההדפסה
  let pdf: string | null = null
  try {
    pdf = await renderPdf(`${internalBaseUrl()}/nissim/${month}/print`, `nissim-${month}.pdf`)
    await withActor(async (tx) => {
      await tx`insert into report_runs (report_type, period, file_url, file_format) values ('nissim_settlement', ${month}, ${pdf}, 'pdf')`
    })
  } catch (e) {
    // הסגירה עצמה תקפה גם אם ה-PDF נכשל; מדווחים ולא מבטלים.
    console.error('PDF failed:', (e as Error).message)
  }

  revalidatePath('/nissim'); revalidatePath('/transactions'); revalidatePath('/pnl')
  return { ok: true, pdf }
}

/** קישור ההעברה בפועל שסגרה את החודש (SPEC §2.1 settlement_transfer_tx_id). */
export async function linkSettlementTransfer(month: string, txId: string) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  try {
    await withActor(async (tx) => {
      await tx`update periods set settlement_transfer_tx_id = ${txId} where division = 'finance' and year = ${y} and month = ${m}`
      await tx`update tasks set status = 'done' where auto_key = ${`settlement_transfer:${month}`} and status <> 'done'`
    })
    revalidatePath('/nissim')
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}

/** SPEC §3.3 "מנקים שולחן" — יתרת פתיחה ידנית, פעם אחת, רק לחודש פתוח. */
export async function setOpeningBalance(month: string, amount: number) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  try {
    await withActor(async (tx) => {
      await tx`insert into periods (division, year, month, status, opening_balance) values ('finance', ${y}, ${m}, 'open', ${amount})
               on conflict (division, year, month) do update set opening_balance = excluded.opening_balance where periods.status = 'open'`
    })
    revalidatePath('/nissim')
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}

export async function settlementTransferCandidates(month: string) {
  const next = addMonths(month, 1)
  return sql<{ id: string; date: string; amount: number; description: string | null }[]>`
    select id, to_char(date_cash,'DD/MM/YYYY') as date, amount_net as amount, description
    from transactions where nature in ('transfer','draw') and deleted_at is null
      and to_char(date_cash,'YYYY-MM') = ${next} order by date_cash`
}
