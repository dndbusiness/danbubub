/**
 * דוח שכר לרו"ח — SPEC §3.9, מסך 19.
 * **אותה פונקציה** למסך, ל-PDF ולמייל (הנחיה 20). כל שורה נושאת את ההסבר
 * שלה ("12 פגישות × 150 ₪ = 1,800 ₪") — זה מה שהרו"ח רואה, וגם העובד.
 */
import { payrollForMonth, payrollTotals, type PayrollLine, type PayrollTotals } from '@/lib/queries/payroll'
import { formatMoney } from '@/lib/ui/format'

export interface PayrollReportData {
  period: string
  generatedAt: string
  lines: PayrollLine[]
  totals: PayrollTotals
}

export async function buildPayrollReport(period: string): Promise<PayrollReportData> {
  const lines = (await payrollForMonth(period)).filter((l) => l.result)
  return { period, generatedAt: new Date().toISOString(), lines, totals: payrollTotals(lines) }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const M = (v: number) => `<span dir="ltr" style="font-variant-numeric:tabular-nums">${formatMoney(v)}</span>`
const heMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`

const PAY_TYPE: Record<string, string> = { payslip: 'תלוש', invoice: 'חשבונית', freelancer: 'פרילנסר' }
const STATUS: Record<string, string> = { draft: 'טיוטה', approved: 'אושר', sent_to_accountant: 'נשלח לרו״ח', paid: 'שולם' }

export function renderPayrollHtml(r: PayrollReportData): string {
  const th = (t: string) => `<th style="padding:5px 7px;text-align:right;border-bottom:1px solid #E6E8EC;font-weight:600;font-size:11px;color:#6B7280">${t}</th>`
  const td = (t: string, end = false) => `<td style="padding:5px 7px;${end ? 'text-align:left;' : ''}border-bottom:1px solid #F3F4F6">${t}</td>`

  const employeeBlocks = r.lines.map((l) => {
    const res = l.result!
    const rows = [
      `<tr>${td('בסיס')}${td(esc(res.baseExplanation))}${td(M(res.base), true)}</tr>`,
      ...res.components.map((c) => `<tr>${td(esc(c.name))}${td(esc(c.explanation) + (c.capped ? ' <span style="color:#D97706">(תקרה)</span>' : ''))}${td(M(c.amount), true)}</tr>`),
      ...res.adjustmentLines.map((a) => `<tr>${td('התאמה')}${td(esc(a.label) + (a.note ? ` — ${esc(a.note)}` : ''))}${td(M(a.amount), true)}</tr>`),
    ].join('')

    const division = Object.entries(res.divisionAllocation)
      .map(([d, v]) => `${d === 'finance' ? 'מימון' : 'נדל״ן'} ${formatMoney(v ?? 0)}`).join(' · ')

    return `
      <section style="margin:14px 0;page-break-inside:avoid">
        <h3 style="margin:0 0 4px;font-size:14px">
          ${esc(l.employee.name)}
          <span style="font-weight:400;color:#6B7280;font-size:12px">
            · ${PAY_TYPE[l.employee.pay_type] ?? l.employee.pay_type}
            ${l.employee.national_id ? ` · ת.ז. ${esc(l.employee.national_id)}` : ''}
            ${l.month ? ` · ${STATUS[l.month.status] ?? l.month.status}` : ''}
          </span>
        </h3>
        ${l.proRata.length > 1 ? `<p style="margin:2px 0;font-size:11px;color:#D97706">ההסכם השתנה באמצע החודש — החישוב פרו-רטה: ${l.proRata.map((p) => `${p.days} ימים`).join(' + ')}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr>${th('רכיב')}${th('איך זה חושב')}${th('סכום')}</tr></thead>
          <tbody>
            ${rows}
            <tr style="font-weight:600;background:#F9FAFB">${td('ברוטו')}${td('')}${td(M(res.grossTotal), true)}</tr>
            ${l.employee.pay_type === 'payslip'
              ? `<tr>${td('עלות מעביד')}${td(`ברוטו × ${Math.round((res.employerCostEst / (res.grossTotal || 1) - 1) * 100)}%`)}${td(M(res.employerCostEst), true)}</tr>`
              : `<tr>${td('עלות לחברה')}${td('חשבונית — ללא עלות מעביד')}${td(M(res.employerCostEst), true)}</tr>`}
            <tr>${td('חלוקה לפעילויות')}${td(esc(division))}${td('', true)}</tr>
          </tbody>
        </table>
      </section>`
  }).join('')

  return `<!doctype html>
<html dir="rtl" lang="he"><head><meta charset="utf-8">
<title>דוח שכר ${heMonth(r.period)}</title>
<style>
  body{font-family:'Assistant','Heebo',Arial,sans-serif;color:#111827;margin:24px;font-size:13px}
  h1{font-size:19px;margin:0 0 2px} h2{font-size:15px;margin:16px 0 6px}
  .muted{color:#6B7280;font-size:12px}
</style></head><body>
  <h1>דוח שכר — ${heMonth(r.period)}</h1>
  <p class="muted">הופק ${new Date(r.generatedAt).toLocaleString('he-IL')} · ${r.totals.employees} עובדים · כל שורה עם ההסבר שלה (§3.9)</p>

  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:10px">
    <thead><tr>${th('סה״כ')}${th('ברוטו')}${th('עלות לחברה')}${th('מימון')}${th('נדל״ן')}</tr></thead>
    <tbody><tr>
      ${td(`${r.totals.employees} עובדים`)}
      ${td(M(r.totals.gross), true)}
      ${td(M(r.totals.employerCost), true)}
      ${td(M(r.totals.byDivision.finance ?? 0), true)}
      ${td(M(r.totals.byDivision.realestate ?? 0), true)}
    </tr></tbody>
  </table>

  <h2>פירוט לעובד</h2>
  ${employeeBlocks || '<p class="muted">אין עובדים עם הסכם בתוקף בחודש הזה.</p>'}

  <p class="muted" style="margin-top:18px">
    עלות המעביד היא הערכה לפי האחוז שבהסכם; המספר המחייב הוא התלוש בפועל.
    תיקון לחודש שאושר נעשה כהתאמה ידנית בחודש הבא, עם הפניה (§3.9).
  </p>
</body></html>`
}

/** XLSX לרו"ח — §5 מסך 19: "PDF+XLSX לרו"ח". CSV בעברית עם BOM נפתח באקסל. */
export function renderPayrollCsv(r: PayrollReportData): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows: string[][] = [[
    'חודש', 'עובד', 'ת.ז.', 'סוג', 'רכיב', 'הסבר', 'סכום', 'ברוטו', 'עלות לחברה', 'מימון', 'נדל״ן', 'סטטוס',
  ]]
  for (const l of r.lines) {
    const res = l.result!
    const common = [l.employee.name, l.employee.national_id ?? '', PAY_TYPE[l.employee.pay_type] ?? l.employee.pay_type]
    rows.push([r.period, ...common, 'בסיס', res.baseExplanation, String(res.base), '', '', '', '', ''])
    for (const c of res.components) rows.push([r.period, ...common, c.name, c.explanation, String(c.amount), '', '', '', '', ''])
    for (const a of res.adjustmentLines) rows.push([r.period, ...common, 'התאמה', a.label, String(a.amount), '', '', '', '', ''])
    rows.push([
      r.period, ...common, 'סה״כ', '', '', String(res.grossTotal), String(res.employerCostEst),
      String(res.divisionAllocation.finance ?? 0), String(res.divisionAllocation.realestate ?? 0),
      STATUS[l.month?.status ?? 'draft'] ?? '',
    ])
  }
  return `﻿${rows.map((r2) => r2.map(q).join(',')).join('\n')}`
}
