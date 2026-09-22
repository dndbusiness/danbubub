'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronLeft, Download, Link2, Lock } from 'lucide-react'
import { closeFinancePeriod, linkSettlementTransfer, setOpeningBalance } from '@/app/actions/periods'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Money } from '@/components/money'
import { DrillDrawer } from '@/components/drill-drawer'
import { DataTable, type Column } from '@/components/data-table'
import { PeriodPill, StatusPill } from '@/components/status-pill'
import { formatMonth } from '@/lib/ui/format'
import type { DrillRow, NissimCardRow, PeriodInfo } from '@/lib/queries/nissim'
import type { ClosingBlocker } from '@/lib/rules/nissim-card.js'
import { cn } from '@/lib/ui/cn'

type DrillKey = 'income' | 'fixed' | 'direct' | 'advances'

/** UIUX §5.3 — 8 שורות, כל מספר לחיץ (▸), חריגים חוסמים, היסטוריה, PDF. */
export function NissimCardView({ month, card, history, period, drill, blockers, askNissim, candidates, canClose }: {
  month: string; card: NissimCardRow | null; history: NissimCardRow[]; period: PeriodInfo | null
  drill: Record<DrillKey, DrillRow[]>; blockers: ClosingBlocker[]; askNissim: { n: number; amount: number }
  candidates: { id: string; date: string; amount: number; description: string | null }[]; canClose: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState<DrillKey | null>(null)
  const [pending, start] = React.useTransition()
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const closed = period?.status === 'closed'
  const [y, m] = month.split('-')
  const nextDue = `10/${String(Number(m) === 12 ? 1 : Number(m) + 1).padStart(2, '0')}`

  const c = card ?? {
    month, line1_collected_income: 0, line2_approved_fixed: 0, line3_direct: 0, line4_distributable_profit: 0,
    line5_nissim_share: 0, line5_harel_share: 0, line6_advances: 0, line7_closing_balance: period?.opening_balance ?? 0,
    line8_transfer_due: 0, opening_amount: period?.opening_balance ?? 0,
  }
  const opening = c.line7_closing_balance - c.line6_advances + c.line5_nissim_share

  function doClose() {
    if (!window.confirm(`לסגור את ${formatMonth(month)}? אחרי הסגירה התקופה נעולה ותיקון נעשה בתנועת תיקון בלבד.`)) return
    start(async () => {
      const r = await closeFinancePeriod(month)
      setMsg(r.ok ? { ok: true, text: r.pdf ? 'החודש נסגר. PDF הופק.' : 'החודש נסגר. הפקת ה-PDF נכשלה — ניתן להפיק שוב מהכפתור.' } : { ok: false, text: `${r.error}${r.blockers ? ': ' + r.blockers.join(' · ') : ''}` })
      router.refresh()
    })
  }

  const Line = ({ n, label, value, drillKey, sign, bold, nature }: { n: string; label: string; value: number; drillKey?: DrillKey; sign?: string; bold?: boolean; nature?: 'open' | 'locked' }) => (
    <div
      role={drillKey ? 'button' : undefined}
      onClick={drillKey ? () => setOpen(drillKey) : undefined}
      className={cn('grid grid-cols-[2rem_1fr_auto_1.5rem] items-center gap-3 py-2.5 border-b border-border last:border-0', drillKey && 'cursor-pointer hover:bg-locked-bg/50 -mx-2 px-2 rounded', bold && 'font-semibold')}
    >
      <span className="text-text-3 tnum text-sm">{n}</span>
      <span className="text-sm">{sign && <span className="text-text-3 me-1">{sign}</span>}{label}</span>
      <Money value={value} size={bold ? 'lg' : 'md'} nature={nature ?? (closed ? 'locked' : undefined)} certainty={!closed && n === '1' ? 'actual' : undefined} />
      <span className="text-text-3">{drillKey && <ChevronLeft size={14} />}</span>
    </div>
  )

  const drillCols: Column<DrillRow>[] = [
    { key: 'date', header: 'תאריך' },
    { key: 'counterparty', header: 'לקוח / ספק' },
    { key: 'label', header: 'תיאור' },
    { key: 'flag', header: '', cell: (r) => r.flag ? <StatusPill tone="expected">{r.flag === 'ask_nissim' ? 'לשאול את ניסים' : r.flag}</StatusPill> : null },
    { key: 'amount', header: 'סכום', align: 'end', cell: (r) => <Money value={r.amount} certainty="actual" /> },
  ]
  const drillTitles: Record<DrillKey, string> = { income: 'הכנסות שנגבו', fixed: 'הוצאות קבועות מוכרות', direct: 'הוצאות ישירות', advances: 'מקדמות החודש' }
  const drillTotals: Record<DrillKey, number> = { income: c.line1_collected_income, fixed: c.line2_approved_fixed, direct: c.line3_direct, advances: c.line6_advances }

  const histCols: Column<NissimCardRow & { id: string }>[] = [
    { key: 'month', header: 'חודש', cell: (r) => <span className={cn(r.month === month && 'font-semibold')}>{formatMonth(r.month)}</span> },
    { key: 'line1_collected_income', header: 'נגבה', align: 'end', cell: (r) => <Money value={r.line1_collected_income} /> },
    { key: 'line2_approved_fixed', header: 'מוכרות', align: 'end', cell: (r) => <Money value={r.line2_approved_fixed} /> },
    { key: 'line3_direct', header: 'ישירות', align: 'end', cell: (r) => <Money value={r.line3_direct} /> },
    { key: 'line4_distributable_profit', header: 'רווח', align: 'end', cell: (r) => <Money value={r.line4_distributable_profit} /> },
    { key: 'line5_nissim_share', header: 'חלק ניסים', align: 'end', cell: (r) => <Money value={r.line5_nissim_share} /> },
    { key: 'line6_advances', header: 'מקדמות', align: 'end', cell: (r) => <Money value={r.line6_advances} /> },
    { key: 'line7_closing_balance', header: 'יתרה', align: 'end', cell: (r) => <Money value={r.line7_closing_balance} nature={r.line7_closing_balance > 0 ? 'open' : 'neutral'} /> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PeriodPill locked={closed} period={formatMonth(month)} />
        {closed && period?.closed_at && <span className="text-xs text-text-3">נסגר {period.closed_at} · {period.closed_by_name}</span>}
        <div className="ms-auto flex gap-2">
          <a href={`/api/reports/nissim/${month}`} className="inline-flex items-center gap-1 h-9 px-3 rounded-[var(--radius-btn)] border border-border bg-surface text-sm hover:bg-locked-bg"><Download size={14} /> PDF</a>
          {canClose && !closed && (
            <Button variant="primary" onClick={doClose} disabled={pending || blockers.length > 0} title={blockers.length ? 'יש חריגים שחוסמים סגירה' : undefined}>
              <Lock size={14} /> {pending ? 'סוגר…' : 'סגור חודש'}
            </Button>
          )}
        </div>
      </div>

      {msg && <div role="status" className={cn('rounded-[var(--radius-card)] p-3 text-sm', msg.ok ? 'bg-actual-bg text-actual' : 'bg-open-bg text-open')}>{msg.text}</div>}

      {/* 8 השורות — UIUX §5.3 */}
      <Card division="finance" className={cn(closed && 'bg-locked-bg')}>
        <Line n="1" label="הכנסות שנגבו" value={c.line1_collected_income} drillKey="income" />
        <Line n="2" label="הוצאות קבועות מאושרות" value={c.line2_approved_fixed} drillKey="fixed" sign="−" />
        <Line n="3" label="הוצאות ישירות" value={c.line3_direct} drillKey="direct" sign="−" />
        <Line n="4" label="רווח לחלוקה" value={c.line4_distributable_profit} sign="=" bold />
        <Line n="5" label="חלק ניסים 50%" value={c.line5_nissim_share} />
        <Line n="" label="חלק הר-אל 50%" value={c.line5_harel_share} />
        <Line n="6" label="מקדמות החודש" value={c.line6_advances} drillKey="advances" />
        <div className="grid grid-cols-[2rem_1fr_auto_1.5rem] items-center gap-3 py-2.5 border-b border-border">
          <span className="text-text-3 tnum text-sm">7</span>
          <span className="text-sm">
            יתרה: פתיחה <Money value={opening} size="sm" /> + <Money value={c.line6_advances} size="sm" /> − <Money value={c.line5_nissim_share} size="sm" /> =
            <span className="block text-xs text-text-2 mt-0.5">{c.line7_closing_balance > 0 ? 'ניסים חייב לחברה' : c.line7_closing_balance < 0 ? 'החברה חייבת לניסים' : 'מאוזן'}</span>
          </span>
          <Money value={c.line7_closing_balance} size="lg" nature={c.line7_closing_balance > 0 ? 'open' : closed ? 'locked' : 'neutral'} />
          <span />
        </div>
        <Line n="8" label={`להעביר עד ${nextDue}`} value={c.line8_transfer_due} bold nature={c.line8_transfer_due > 0 ? 'open' : 'locked'} />
      </Card>

      {/* חריגים שחוסמים סגירה — SPEC §3.3 שלב 2 */}
      {!closed && (
        <Card className="flex flex-col gap-2">
          <div className="text-sm font-medium">
            {blockers.length ? `חריגים שחוסמים סגירה (${blockers.length})` : 'אין חריגים חוסמים ✓'}
          </div>
          {blockers.map((b) => (
            <div key={b.kind} data-blocker className="flex items-center gap-2 text-sm text-open"><AlertTriangle size={14} /> {b.label}</div>
          ))}
          {askNissim.n > 0 && (
            <div className="flex items-center gap-2 text-sm text-expected"><AlertTriangle size={14} /> {askNissim.n} תנועות "לשאול את ניסים" (Σ <Money value={askNissim.amount} size="sm" certainty="expected" />) — לא חוסמות, אבל נכנסות למספרים. לאמת לפני סגירה (שאלה #23).</div>
          )}
        </Card>
      )}

      {/* קישור ההעברה בפועל (SPEC §3.3 שלב 3) */}
      {closed && c.line8_transfer_due > 0 && (
        <Card className="flex flex-wrap items-center gap-3 text-sm">
          <Link2 size={16} className="text-text-2" />
          {period?.settlement_transfer_tx_id ? <span className="text-actual">ההעברה בפועל קושרה ✓</span> : (
            <>
              <span>ההעברה בפועל:</span>
              <select defaultValue="" onChange={(e) => e.target.value && start(async () => { await linkSettlementTransfer(month, e.target.value); router.refresh() })}
                className="h-9 rounded-[var(--radius-btn)] border border-border bg-surface px-2">
                <option value="" disabled>בחר תנועה מהחודש הבא…</option>
                {candidates.map((t) => <option key={t.id} value={t.id}>{t.date} · {t.description ?? ''} · {t.amount.toLocaleString('he-IL')} ₪</option>)}
              </select>
              {candidates.length === 0 && <span className="text-text-3">אין עדיין תנועת העברה בחודש הבא</span>}
            </>
          )}
        </Card>
      )}

      {/* "מנקים שולחן" — יתרת פתיחה ידנית לחודש הראשון */}
      {!closed && !history.some((h) => h.month < month) && (
        <Card className="flex flex-wrap items-center gap-3 text-sm">
          <span>יתרת פתיחה ("מנקים שולחן", §3.3):</span>
          <form action={(fd) => start(async () => { await setOpeningBalance(month, Number(fd.get('amount'))); router.refresh() })} className="flex gap-2">
            <input name="amount" defaultValue={period?.opening_balance ?? 0} inputMode="decimal" dir="ltr" className="h-9 w-32 rounded-[var(--radius-btn)] border border-border bg-surface px-2 tnum" />
            <Button type="submit" size="sm">שמור</Button>
          </form>
        </Card>
      )}

      {/* היסטוריה — UIUX §5.3 */}
      <h2 className="text-base font-semibold mt-2">היסטוריה</h2>
      <DataTable rows={history.map((h) => ({ ...h, id: h.month }))} columns={histCols} exportName="nissim-card" initialSort={{ key: 'month', dir: 'asc' }}
        onRowClick={(r) => router.push(`/nissim?period=${r.month}`)} primaryKeys={['month', 'line4_distributable_profit', 'line7_closing_balance']} />

      <DrillDrawer open={open !== null} onOpenChange={(o) => !o && setOpen(null)} title={open ? drillTitles[open] : ''}
        amount={open && <Money value={drillTotals[open]} size="lg" />} breadcrumb={['כרטיס ניסים', formatMonth(month)]}>
        {open && <DataTable rows={drill[open]} columns={drillCols} exportName={`nissim-${month}-${open}`} emptyState="אין שורות" />}
      </DrillDrawer>
    </div>
  )
}
