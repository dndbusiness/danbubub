/**
 * דוח פערי חשבוניות — SPEC §4.3 בדיקה 3, 12 חודשים אחורה.
 * זהו קריטריון הסיום של שלב 6: "דוח פערים 12 חודשים אחורה מופק ונשלח לרו"ח".
 * אותה פונקציה למסך, ל-PDF ולמייל (הנחיה 20).
 */
import { gapLines, gapsByMonth, type GapMonthRow, type GapRow } from '@/lib/queries/gaps'
import { formatMoney } from '@/lib/ui/format'
import { GAP_LABEL } from '@/lib/ui/labels'

export { GAP_LABEL }

export interface GapsReportData {
  generatedAt: string
  months: GapMonthRow[]
  lines: GapRow[]
  totals: { incomeWithoutInvoice: number; incomeAmount: number; invoiceWithoutReceipt: number; invoiceAmount: number; expenseWithoutInvoice: number; expenseAmount: number; vatAtRisk: number }
}

export async function buildGapsReport(): Promise<GapsReportData> {
  const [months, lines] = await Promise.all([gapsByMonth(), gapLines()])
  return {
    generatedAt: new Date().toISOString(),
    months, lines,
    totals: {
      incomeWithoutInvoice: months.reduce((a, m) => a + m.income_without_invoice, 0),
      incomeAmount: months.reduce((a, m) => a + Number(m.income_without_invoice_amount), 0),
      invoiceWithoutReceipt: months.reduce((a, m) => a + m.invoice_without_receipt, 0),
      invoiceAmount: months.reduce((a, m) => a + Number(m.invoice_without_receipt_amount), 0),
      expenseWithoutInvoice: months.reduce((a, m) => a + m.expense_without_invoice, 0),
      expenseAmount: months.reduce((a, m) => a + Number(m.expense_without_invoice_amount), 0),
      vatAtRisk: months.reduce((a, m) => a + Number(m.vat_at_risk), 0),
    },
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const M = (v: number) => `<span dir="ltr" style="font-variant-numeric:tabular-nums">${formatMoney(v)}</span>`
const heMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`


export function renderGapsHtml(r: GapsReportData, baseUrl = ''): string {
  const th = (t: string) => `<th style="padding:4px 6px;text-align:right;border-bottom:1px solid #E6E8EC;font-weight:600;font-size:11px;color:#6B7280">${t}</th>`
  const td = (t: string, end = false) => `<td style="padding:4px 6px;${end ? 'text-align:left;' : ''}border-bottom:1px solid #F3F4F6">${t}</td>`
  const t = r.totals

  const monthRows = r.months.map((m) => `<tr>
    ${td(heMonth(m.month))}
    ${td(m.income_without_invoice ? `${m.income_without_invoice} · ${formatMoney(Number(m.income_without_invoice_amount))}` : '—', true)}
    ${td(m.invoice_without_receipt ? `${m.invoice_without_receipt} · ${formatMoney(Number(m.invoice_without_receipt_amount))}` : '—', true)}
    ${td(m.expense_without_invoice ? `${m.expense_without_invoice} · ${formatMoney(Number(m.expense_without_invoice_amount))}` : '—', true)}
    ${td(Number(m.vat_at_risk) ? `<span style="color:#DC2626">${formatMoney(Number(m.vat_at_risk))}</span>` : '—', true)}
  </tr>`).join('')

  const byKind = (kind: string) => r.lines.filter((l) => l.gap_kind === kind).slice(0, 60)
  const detail = (kind: string) => {
    const rows = byKind(kind)
    if (!rows.length) return `<p style="color:#9CA3AF;font-size:12px;margin:2px 0">אין</p>`
    return `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <tr>${th('תאריך')}${th('צד נגדי')}${th('תיאור')}${th('סכום')}${kind === 'expense_without_invoice' ? th('מע״מ בסיכון') : ''}</tr>
      ${rows.map((l) => `<tr>${td(l.date)}${td(esc(l.counterparty ?? '—'))}${td(esc((l.description ?? '').slice(0, 60)))}${td(M(Number(l.amount)), true)}${kind === 'expense_without_invoice' ? td(M(Number(l.vat_at_risk)), true) : ''}</tr>`).join('')}
      ${byKind(kind).length < r.lines.filter((l) => l.gap_kind === kind).length ? `<tr>${td(`… ועוד ${r.lines.filter((l) => l.gap_kind === kind).length - 60} שורות`)}</tr>` : ''}
    </table>`
  }

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח פערי חשבוניות</title></head>
<body style="margin:0;background:#F7F8FA;font-family:Heebo,Assistant,Arial,sans-serif;color:#111827;font-size:13px">
<div style="max-width:760px;margin:0 auto;background:#fff;padding:24px">
  <h1 style="font-size:19px;margin:0">הר-אל · דוח פערי חשבוניות</h1>
  <div style="color:#6B7280;font-size:12px;margin-bottom:12px">12 חודשים אחורה · הופק ${r.generatedAt.slice(0, 16).replace('T', ' ')}${baseUrl ? ` · <a href="${baseUrl}/gaps" style="color:#0F766E">למסך</a>` : ''}</div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
    <tr>
      <td style="padding:8px;background:#F7F8FA">הכנסות בלי מסמך<br><b>${t.incomeWithoutInvoice}</b> · ${formatMoney(t.incomeAmount)}</td>
      <td style="padding:8px;background:#F7F8FA">מסמכים בלי כסף<br><b>${t.invoiceWithoutReceipt}</b> · ${formatMoney(t.invoiceAmount)}</td>
      <td style="padding:8px;background:#F7F8FA">הוצאות בלי חשבונית<br><b>${t.expenseWithoutInvoice}</b> · ${formatMoney(t.expenseAmount)}</td>
      <td style="padding:8px;background:#FEF2F2;color:#DC2626">מע״מ בסיכון<br><b>${formatMoney(t.vatAtRisk)}</b></td>
    </tr>
  </table>

  <h2 style="font-size:14px;margin:16px 0 4px;color:#6B7280">לפי חודש</h2>
  <table style="width:100%;border-collapse:collapse;font-size:12px">
    <tr>${th('חודש')}${th('הכנסות בלי מסמך')}${th('מסמכים בלי כסף')}${th('הוצאות בלי חשבונית')}${th('מע״מ בסיכון')}</tr>
    ${monthRows}
  </table>

  <h2 style="font-size:14px;margin:18px 0 4px;color:#6B7280">1. הכנסות בבנק בלי חשבונית</h2>${detail('income_without_invoice')}
  <h2 style="font-size:14px;margin:18px 0 4px;color:#6B7280">2. חשבוניות שהוצאו בלי תקבול</h2>${detail('invoice_without_receipt')}
  <h2 style="font-size:14px;margin:18px 0 4px;color:#6B7280">3. הוצאות בלי חשבונית ספק</h2>${detail('expense_without_invoice')}

  <p style="font-size:11px;color:#9CA3AF;margin-top:18px">
    הופק אוטומטית ממערכת הכספים של הר-אל (SPEC §4.3 בדיקה 3).
    תנועות שסומנו "לא נדרשת חשבונית" (עמלות בנק, ביטוח לאומי, מס) אינן נספרות.
  </p>
</div></body></html>`
}
