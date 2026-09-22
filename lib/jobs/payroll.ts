import { readFile } from 'node:fs/promises'
import { sql, withActor } from '@/lib/db'
import { internalBaseUrl, renderPdf } from '@/lib/pdf'
import { settingValues } from '@/lib/queries/cashflow'
import { payrollForMonth, payrollTotals } from '@/lib/queries/payroll'
import { ensureFolderPath, reportFolder, uploadFile } from '@/lib/google/drive'
import { googleAccessToken, googleIntegration, hasScope } from '@/lib/google/store'
import { addMonths, monthOf } from '@/lib/rules/period'
import { enqueueOutbox, flushOutbox } from './outbox'
import { runJob } from './run'

type Out = { rowsTouched: number; skipped?: string; detail?: Record<string, unknown> }

/**
 * חלק ג' `payroll_reminder` — "27 לחודש · אירוע + וואטסאפ".
 * מזכיר לאשר את השכר לפני שהחודש נסגר, ומפרט מי עוד בטיוטה ומה חסר.
 */
export async function payrollReminderJob(asOf: string): Promise<Out & { month: string }> {
  return runJob('payroll_reminder', async () => {
    const month = monthOf(asOf)
    const lines = await payrollForMonth(month)
    const drafts = lines.filter((l) => l.result && (!l.month || l.month.status === 'draft'))
    const missing = lines.filter((l) => l.missingInputs.length)
    if (!drafts.length) return { rowsTouched: 0, skipped: 'כל השכר לחודש כבר אושר', month }

    const totals = payrollTotals(lines)
    const s = await settingValues(['notify_whatsapp_dan', 'notify_email_dan'])
    const whatsapp = typeof s.notify_whatsapp_dan === 'string' ? s.notify_whatsapp_dan : null
    const email = typeof s.notify_email_dan === 'string' ? s.notify_email_dan : null
    const base = process.env.APP_BASE_URL ?? ''
    const text = [
      `שכר ${month}: ${drafts.length} עובדים ממתינים לאישור (${Math.round(totals.gross).toLocaleString('he-IL')} ₪ ברוטו).`,
      missing.length ? `חסר קלט: ${missing.map((l) => `${l.employee.name} — ${l.missingInputs.join(', ')}`).join(' · ')}` : null,
      base ? `${base}/payroll?period=${month}` : null,
    ].filter(Boolean).join('\n')

    const dedupKey = `payroll_reminder:${month}`
    const rows = [
      ...(whatsapp ? [{ channel: 'whatsapp' as const, target: whatsapp, subject: null, body: text, dedupKey: `${dedupKey}:wa` }] : []),
      ...(email ? [{ channel: 'email' as const, target: email, subject: `הר-אל · אישור שכר ${month}`, body: `<div dir="rtl">${text.replace(/\n/g, '<br>')}</div>`, dedupKey: `${dedupKey}:mail` }] : []),
    ]
    if (!rows.length) return { rowsTouched: 0, skipped: 'לא הוגדרו יעדי מסירה (notify_whatsapp_dan / notify_email_dan)', month }

    const queued = await enqueueOutbox(rows)
    // משימה עם rule_key ייחודי (הנחיה 18) — כדי שזה לא ייעלם אם ההודעה לא נשלחה.
    const tasks = await withActor(async (tx) => {
      const res = await tx`
        insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
        values (${`לאשר שכר ${month}`}, ${asOf}, 'high', true, ${`payroll_approval:${month}`},
                ${`${drafts.length} עובדים בטיוטה${missing.length ? ` · חסר קלט ל-${missing.length}` : ''}`})
        on conflict do nothing`
      return res.count
    })
    const flush = queued ? await flushOutbox() : null
    return { rowsTouched: queued + tasks, detail: { drafts: drafts.length, missing: missing.length, flush }, month }
  })
}

/**
 * חלק ג' `accountant_payroll_send` — "30 לחודש (אם אושר; אחרת יומי עד ה-3)".
 * שולח את דוח השכר לרו"ח, מסמן `sent_to_accountant`, ומעלה לדרייב.
 * לא שולח חודש שלא אושר — אלא פותח משימה.
 */
export async function accountantPayrollSendJob(asOf: string): Promise<Out & { month: string }> {
  return runJob('accountant_payroll_send', async () => {
    const day = Number(asOf.slice(8, 10))
    // עד ה-3 בחודש מדובר בשכר של החודש הקודם; מה-4 ואילך — של החודש הנוכחי.
    const month = day <= 3 ? addMonths(monthOf(asOf), -1) : monthOf(asOf)
    const lines = (await payrollForMonth(month)).filter((l) => l.result)
    if (!lines.length) return { rowsTouched: 0, skipped: `אין שכר מחושב ל-${month}`, month }

    const pending = lines.filter((l) => !l.month || l.month.status === 'draft')
    if (pending.length) {
      const tasks = await withActor(async (tx) => {
        const res = await tx`
          insert into tasks (title, due_date, priority, auto_generated, auto_key, notes)
          values (${`שכר ${month} לא אושר — הרו"ח מחכה`}, ${asOf}, 'high', true, ${`payroll_not_approved:${month}`},
                  ${`${pending.map((l) => l.employee.name).join(', ')} עדיין בטיוטה`})
          on conflict do nothing`
        return res.count
      })
      return { rowsTouched: tasks, skipped: `${pending.length} עובדים עדיין בטיוטה — לא נשלח`, month }
    }

    const alreadySent = lines.every((l) => l.month && l.month.status !== 'approved')
    if (alreadySent) return { rowsTouched: 0, skipped: 'כבר נשלח לרו"ח', month }

    const s = await settingValues(['accountant_email', 'notify_email_dan'])
    const accountant = typeof s.accountant_email === 'string' ? s.accountant_email : null
    const dan = typeof s.notify_email_dan === 'string' ? s.notify_email_dan : null
    const to = [accountant, dan].filter((x): x is string => Boolean(x))

    let pdf: string | null = null
    try { pdf = await renderPdf(`${internalBaseUrl()}/reports/payroll/${month}`, `payroll-${month}.pdf`) } catch (e) { console.error('payroll PDF:', (e as Error).message) }

    let drive: string | null = null
    if (pdf) {
      const google = await googleIntegration()
      if (hasScope(google, 'https://www.googleapis.com/auth/drive.file')) {
        try {
          const token = await googleAccessToken()
          const folder = await ensureFolderPath(token, reportFolder('payroll', month))
          drive = (await uploadFile(token, folder, `שכר-${month}.pdf`, 'application/pdf', await readFile(pdf))).webViewLink
        } catch (e) { console.error('Drive upload failed:', (e as Error).message) }
      }
    }

    const totals = payrollTotals(lines)
    let outboxId: string | null = null
    let queued = 0
    if (to.length) {
      const dedupKey = `payroll_send:${month}`
      const body = `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;font-size:14px">
        <p>מצורף דוח השכר לחודש ${month}.</p>
        <p>${totals.employees} עובדים · ברוטו ${Math.round(totals.gross).toLocaleString('he-IL')} ₪ · עלות לחברה ${Math.round(totals.employerCost).toLocaleString('he-IL')} ₪</p>
        <p>כל רכיב בדוח מופיע עם ההסבר שלו (§3.9).${drive ? ` <a href="${drive}">הקובץ בדרייב</a>` : ''}</p></div>`
      queued = await enqueueOutbox([{ channel: 'email', target: to.join(','), subject: `הר-אל · דוח שכר ${month}`, body, dedupKey }])
      if (queued) {
        const [ob] = await sql<{ id: string }[]>`select id from outbox where dedup_key = ${dedupKey}`
        outboxId = ob?.id ?? null
        if (outboxId && pdf) await sql`update outbox set payload = ${sql.json({ pdfPath: pdf, fileName: `דוח-שכר-${month}.pdf` } as never)} where id = ${outboxId}`
      }
    }

    const marked = await withActor(async (tx) => {
      const res = await tx`
        update payroll_months set status = 'sent_to_accountant', report_file_url = ${drive ?? pdf}
        where period = ${month} and status = 'approved' and deleted_at is null`
      await tx`insert into report_runs (report_type, period, file_url, file_format, recipients, outbox_id, sent_at)
               values ('payroll', ${month}, ${drive ?? pdf}, 'pdf', ${to}, ${outboxId}, ${to.length ? 'now()' : null}::timestamptz)`
      return res.count
    })
    const flush = queued ? await flushOutbox() : null
    return {
      rowsTouched: marked,
      detail: { employees: totals.employees, gross: totals.gross, drive: Boolean(drive), pdf: Boolean(pdf), flush },
      month,
      ...(to.length ? {} : { skipped: 'אין מייל רו"ח — הדוח הופק ונרשם אבל לא נשלח' }),
    }
  })
}
