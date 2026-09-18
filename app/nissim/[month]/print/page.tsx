import { nissimCardFor, nissimDrill, periodFor } from '@/lib/queries/nissim'
import { formatMoney, formatMonth } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

/**
 * "דוח התחשבנות M/YYYY" — SPEC §7: PDF RTL, כותרת עם ישות + תקופה + תאריך הפקה + "הופק ע"י".
 * אותו HTML משמש להדפסה מהדפדפן ול-PDF דרך Playwright (§11.20).
 */
export default async function NissimPrint({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params
  const [card, drill, period] = await Promise.all([nissimCardFor(month), nissimDrill(month), periodFor(month)])
  const produced = new Date().toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
  const c = card
  const opening = c ? c.line7_closing_balance - c.line6_advances + c.line5_nissim_share : 0
  const M = (v: number) => <span dir="ltr" className="tnum">{formatMoney(v)}</span>

  return (
    <html lang="he" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <title>דוח התחשבנות {formatMonth(month)}</title>
        <style>{`
          body { font-family: Heebo, Assistant, Arial, sans-serif; color: #111827; margin: 0; padding: 24px; font-size: 13px; }
          h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #6B7280; font-size: 12px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { padding: 6px 8px; border-bottom: 1px solid #E6E8EC; text-align: right; }
          td.n, th.n { text-align: left; font-variant-numeric: tabular-nums; }
          .lines td { font-size: 14px; } .bold td { font-weight: 700; } .total td { font-size: 16px; font-weight: 700; border-top: 2px solid #111827; }
          h2 { font-size: 14px; margin: 18px 0 6px; color: #6B7280; }
          .locked { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #F3F4F6; color: #6B7280; font-size: 11px; }
          .foot { margin-top: 28px; color: #9CA3AF; font-size: 11px; }
          @page { size: A4; margin: 14mm 12mm; }
        `}</style>
      </head>
      <body>
        <h1>דוח התחשבנות — {formatMonth(month)}</h1>
        <div className="sub">
          הר-אל פתרונות מימון · חלוקת רווח 50/50 · הופק {produced} ע״י דן
          {period?.status === 'closed' && <> · <span className="locked">🔒 נסגר {period.closed_at}</span></>}
        </div>

        {!c ? <p>אין נתונים לחודש זה.</p> : (
          <table className="lines">
            <tbody>
              <tr><td>1</td><td>הכנסות שנגבו</td><td className="n">{M(c.line1_collected_income)}</td></tr>
              <tr><td>2</td><td>− הוצאות קבועות מאושרות</td><td className="n">{M(c.line2_approved_fixed)}</td></tr>
              <tr><td>3</td><td>− הוצאות ישירות</td><td className="n">{M(c.line3_direct)}</td></tr>
              <tr className="bold"><td>4</td><td>= רווח לחלוקה</td><td className="n">{M(c.line4_distributable_profit)}</td></tr>
              <tr><td>5</td><td>חלק ניסים 50%</td><td className="n">{M(c.line5_nissim_share)}</td></tr>
              <tr><td></td><td>חלק הר-אל 50%</td><td className="n">{M(c.line5_harel_share)}</td></tr>
              <tr><td>6</td><td>מקדמות החודש</td><td className="n">{M(c.line6_advances)}</td></tr>
              <tr className="bold"><td>7</td><td>יתרה: פתיחה {M(opening)} + מקדמות − חלק ניסים → {c.line7_closing_balance > 0 ? 'ניסים חייב לחברה' : c.line7_closing_balance < 0 ? 'החברה חייבת לניסים' : 'מאוזן'}</td><td className="n">{M(c.line7_closing_balance)}</td></tr>
              <tr className="total"><td>8</td><td>להעביר עד ה-10 לחודש הבא</td><td className="n">{M(c.line8_transfer_due)}</td></tr>
            </tbody>
          </table>
        )}

        {(['income', 'fixed', 'direct', 'advances'] as const).map((k) => (
          <div key={k}>
            <h2>{{ income: '1 · הכנסות שנגבו', fixed: '2 · הוצאות קבועות מאושרות', direct: '3 · הוצאות ישירות', advances: '6 · מקדמות' }[k]}</h2>
            <table>
              <thead><tr><th>תאריך</th><th>לקוח / ספק</th><th>תיאור</th><th className="n">סכום</th></tr></thead>
              <tbody>
                {drill[k].length === 0 && <tr><td colSpan={4} style={{ color: '#9CA3AF' }}>—</td></tr>}
                {drill[k].map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.counterparty}</td><td>{r.label}{r.flag ? ' (לבדיקה)' : ''}</td><td className="n">{M(r.amount)}</td></tr>)}
              </tbody>
            </table>
          </div>
        ))}
        <div className="foot">SPEC §3.3 · מסמך זה הופק ממערכת הכספים של הר-אל. תקופה סגורה אינה משתנה; תיקון נעשה בתנועת תיקון בתקופה הפתוחה.</div>
      </body>
    </html>
  )
}
