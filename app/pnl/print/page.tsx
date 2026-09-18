import { pnlExpenseLines, pnlIncomeLines, pnlTotals, type PnlMode } from '@/lib/queries/pnl'
import { formatMoney, formatMonth } from '@/lib/ui/format'
import type { SearchParams } from '@/lib/ui/params'

export const dynamic = 'force-dynamic'

/** רווח והפסד להדפסה / PDF — SPEC §7. */
export default async function PnlPrint({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const period = typeof sp.period === 'string' ? sp.period : new Date().toISOString().slice(0, 7)
  const division = sp.division === 'realestate' ? 'realestate' : 'finance'
  const mode: PnlMode = sp.mode === 'operational' ? 'operational' : 'distributable'
  const [t, income, expenses] = await Promise.all([pnlTotals(period, division, mode), pnlIncomeLines(period, division, mode), pnlExpenseLines(period, division, mode)])
  const M = (v: number) => <span dir="ltr" className="tnum">{formatMoney(v)}</span>
  return (
    <html lang="he" dir="rtl"><head><meta charSet="utf-8" /><title>רווח והפסד {formatMonth(period)}</title>
      <style>{`body{font-family:Heebo,Assistant,Arial,sans-serif;color:#111827;margin:0;padding:24px;font-size:13px}h1{font-size:20px;margin:0 0 4px}.sub{color:#6B7280;font-size:12px;margin-bottom:20px}table{width:100%;border-collapse:collapse;margin-bottom:18px}th,td{padding:6px 8px;border-bottom:1px solid #E6E8EC;text-align:right}td.n,th.n{text-align:left;font-variant-numeric:tabular-nums}.total td{font-weight:700;border-top:2px solid #111827;font-size:15px}h2{font-size:14px;margin:16px 0 6px;color:#6B7280}@page{size:A4;margin:14mm 12mm}`}</style>
    </head><body>
      <h1>רווח והפסד — {mode === 'operational' ? 'רווח תפעולי' : 'רווח לחלוקה'} · {formatMonth(period)}</h1>
      <div className="sub">{division === 'finance' ? 'הר-אל פתרונות מימון' : 'הר-אל השקעות נדל״ן'} · הופק {new Date().toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })} ע״י דן · {mode === 'operational' ? 'כל ההוצאות, כולל לא-מוכרות' : 'רק הוצאות מוכרות (ובמימון: מאושרות 50/50); ישירות לפי חודש התיק'}</div>
      <table><tbody>
        <tr><td>הכנסות</td><td className="n">{M(t.income)}</td></tr>
        <tr><td>− הוצאות קבועות</td><td className="n">{M(t.fixed_expenses)}</td></tr>
        <tr><td>− הוצאות ישירות</td><td className="n">{M(t.direct_expenses)}</td></tr>
        <tr><td>− הוצאות אחרות</td><td className="n">{M(t.total_expenses - t.fixed_expenses - t.direct_expenses)}</td></tr>
        <tr className="total"><td>= {mode === 'operational' ? 'רווח תפעולי' : 'רווח לחלוקה'}</td><td className="n">{M(t.profit)}</td></tr>
      </tbody></table>
      <h2>הכנסות לפי תיק</h2>
      <table><tbody>{income.map((r) => <tr key={r.key}><td>{r.label}</td><td className="n">{M(r.amount)}</td></tr>)}</tbody></table>
      <h2>הוצאות לפי קטגוריה</h2>
      <table><tbody>{expenses.map((r) => <tr key={r.key}><td>{r.label}</td><td className="n">{M(r.amount)}</td></tr>)}</tbody></table>
    </body></html>
  )
}
