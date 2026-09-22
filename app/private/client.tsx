'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Plus, RotateCcw, Trash2, Users } from 'lucide-react'
import { addPrivateIncome, deletePrivateIncome, markPrivateExpected, markPrivateReceived, setPrivateSplit } from '@/app/actions/private'
import { ActionDrawerForm } from '@/components/forms/action-form'
import { DataTable, type Column } from '@/components/data-table'
import { DrillDrawer } from '@/components/drill-drawer'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Textarea } from '@/components/ui/field'
import { StatusPill } from '@/components/status-pill'
import type { PrivateRow } from '@/lib/queries/private'
import { evaluateThreshold, NO_THRESHOLD_RULE, type PrivateSummary } from '@/lib/rules/private'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

/** מסך 9 — טבלת קרנות, חוקי סף, צפוי/התקבל, חלוקה דן/ניסים (SPEC §5). */
export function PrivateView({ rows, summary }: { rows: PrivateRow[]; summary: PrivateSummary }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [receiving, setReceiving] = React.useState<PrivateRow | null>(null)
  const [splitting, setSplitting] = React.useState<PrivateRow | null>(null)

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => { const r = await fn(); if (!r.ok) { setError(r.error); return } setError(null); router.refresh() })

  const thresholdText = (r: PrivateRow) => {
    const res = evaluateThreshold(r.threshold_rule, { dealAmount: Number(r.deal_amount ?? 0) })
    if (res) return res.explanation
    return r.pct ? `${(Number(r.pct) * 100).toFixed(2)}% — ${NO_THRESHOLD_RULE}` : NO_THRESHOLD_RULE
  }

  const columns: Column<PrivateRow>[] = [
    { key: 'fund_name', header: 'קרן', cell: (r) => <span className="font-medium">{r.fund_name}</span> },
    { key: 'deal_ref', header: 'עסקה', cell: (r) => <span className="truncate">{r.deal_ref ?? '—'}</span> },
    { key: 'deal_amount', header: 'סכום העסקה', align: 'end', mobileHidden: true, value: (r) => Number(r.deal_amount ?? 0), cell: (r) => r.deal_amount ? <span className="tnum text-text-2">{formatMoney(Number(r.deal_amount))}</span> : <span className="text-text-3">—</span> },
    { key: 'pct', header: 'אחוז', align: 'end', mobileHidden: true, value: (r) => Number(r.pct ?? 0), cell: (r) => r.pct ? <span className="tnum">{(Number(r.pct) * 100).toFixed(2)}%</span> : <span className="text-text-3">—</span> },
    { key: 'amount_net', header: 'סכום', align: 'end', value: (r) => Number(r.amount_net), cell: (r) => <Money value={Number(r.amount_net)} certainty={r.status === 'received' ? 'actual' : 'expected'} />, footer: <Money value={summary.total.amountNet} /> },
    { key: 'dan_amount', header: 'דן', align: 'end', value: (r) => Number(r.dan_amount), cell: (r) => <span className="tnum">{formatMoney(Number(r.dan_amount))}</span>, footer: <span className="tnum">{formatMoney(summary.total.dan)}</span> },
    { key: 'nissim_amount', header: 'ניסים', align: 'end', value: (r) => Number(r.nissim_amount), cell: (r) => <span className="tnum">{formatMoney(Number(r.nissim_amount))}</span>, footer: <span className="tnum">{formatMoney(summary.total.nissim)}</span> },
    {
      key: 'status', header: 'מצב', value: (r) => r.status,
      cell: (r) => r.status === 'received'
        ? <StatusPill tone="actual" icon={Check}>התקבל{r.received_date ? ` ${formatDate(r.received_date)}` : ''}</StatusPill>
        : <StatusPill tone="expected">צפוי</StatusPill>,
    },
    {
      key: 'actions', header: '',
      cell: (r) => (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status === 'expected'
            ? <Button size="sm" variant="secondary" disabled={pending} title="סמן שהתקבל" onClick={() => setReceiving(r)}><Check size={14} /></Button>
            : <Button size="sm" variant="ghost" disabled={pending} title="החזר ל'צפוי'" onClick={() => act(() => markPrivateExpected(r.id))}><RotateCcw size={14} /></Button>}
          <Button size="sm" variant="ghost" disabled={pending} title="שנה חלוקה" onClick={() => setSplitting(r)}><Users size={14} /></Button>
          <Button size="sm" variant="ghost" disabled={pending} title="בטל שורה"
            onClick={() => { if (confirm(`לבטל את ${r.fund_name} — ${r.deal_ref ?? formatMoney(Number(r.amount_net))}?`)) act(() => deletePrivateIncome(r.id)) }}><Trash2 size={14} /></Button>
        </span>
      ),
    },
  ]

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="התקבל" value={summary.received.amountNet} certainty="actual"
          subtitle={`${summary.received.rows} עסקאות · דן ${formatMoney(summary.received.dan)} · ניסים ${formatMoney(summary.received.nissim)}`}
          drillTitle="שהתקבלו" drill={<RowList rows={rows.filter((r) => r.status === 'received')} />} />
        <KpiCard title="צפוי" value={summary.expected.amountNet} certainty="expected"
          subtitle={`${summary.expected.rows} עסקאות · דן ${formatMoney(summary.expected.dan)} · ניסים ${formatMoney(summary.expected.nissim)}`}
          drillTitle="צפויות" drill={<RowList rows={rows.filter((r) => r.status === 'expected')} />} />
        <KpiCard title="החלק של דן" value={summary.total.dan} count={false}
          subtitle="מכל השורות, לפי החלוקה של כל שורה בנפרד"
          drillTitle="לפי קרן" drill={<FundList summary={summary} who="dan" />} />
        <KpiCard title="החלק של ניסים" value={summary.total.nissim} count={false}
          subtitle="לא עובר דרך כרטיס ניסים — זה כסף פרטי (§2.1)"
          drillTitle="לפי קרן" drill={<FundList summary={summary} who="nissim" />} />
      </div>

      <Card className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-text-2">
          הכסף הזה לא נכנס לאף דוח עסקי. אם תקבול פרייבט נחת בחשבון החברה — לרשום אותו כהעברה
          החוצה ולסמן (§2.1).
        </span>
        <span className="ms-auto">
          <ActionDrawerForm
            title="הכנסת פרייבט חדשה"
            action={addPrivateIncome}
            submitLabel="שמור"
            trigger={<Button variant="primary" type="button"><Plus size={16} /> שורה חדשה</Button>}
          >
            <Field label="קרן" required><Input name="fund_name" required list="fund-names" /></Field>
            <datalist id="fund-names">{[...new Set(rows.map((r) => r.fund_name))].map((f) => <option key={f} value={f} />)}</datalist>
            <Field label="עסקה"><Input name="deal_ref" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="סכום העסקה" hint="בקרן"><Input name="deal_amount" inputMode="decimal" /></Field>
              <Field label="אחוז" hint="למשל 1"><Input name="pct" inputMode="decimal" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="הסכום שלנו" required><Input name="amount_net" inputMode="decimal" required /></Field>
              <Field label="מע״מ" hint="לא נכנס למע״מ החברה"><Input name="vat_amount" inputMode="decimal" defaultValue="0" /></Field>
            </div>
            <Field label="חלוקה לדן (%)" required hint="ברירת מחדל 50 — השאר לניסים">
              <Input name="split_dan" inputMode="decimal" defaultValue="50" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="תאריך קבלה" hint="ריק = עדיין צפוי"><Input name="received_date" type="date" /></Field>
              <Field label="לאן נכנס" hint="חשבון פרטי"><Input name="received_to" /></Field>
            </div>
            <Field label="הערה"><Textarea name="note" rows={2} /></Field>
          </ActionDrawerForm>
        </span>
      </Card>

      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      <DataTable rows={rows} columns={columns} exportName="private-income"
        primaryKeys={['fund_name', 'amount_net', 'status']} emptyState="אין עדיין שורות פרייבט" />

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-sm">חוקי סף לפי קרן</h2>
        <p className="text-xs text-text-3">
          §2.1 — "מעל 3M חודשי → 1%" היא דוגמה. החוקים האמיתיים לכל קרן טרם נמסרו (שאלה פתוחה #7),
          ולכן המערכת מציגה את מה שיש ולא מחשבת אחוז בעצמה.
        </p>
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="text-xs text-text-2 bg-locked-bg"><tr><th className="text-start p-2">קרן</th><th className="text-start p-2">עסקה</th><th className="text-start p-2">הכלל</th><th className="text-end p-2">סכום</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2">{r.fund_name}</td>
                  <td className="p-2 text-text-2">{r.deal_ref ?? '—'}</td>
                  <td className="p-2 text-xs text-text-3">{thresholdText(r)}</td>
                  <td className="p-2 text-end"><Money value={Number(r.amount_net)} certainty={r.status === 'received' ? 'actual' : 'expected'} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="p-4 text-center text-text-3">אין שורות</td></tr>}
            </tbody>
          </table>
        </Card>
      </section>

      <DrillDrawer open={Boolean(receiving)} onOpenChange={(o) => !o && setReceiving(null)} title={receiving ? `התקבל — ${receiving.fund_name}` : ''}>
        {receiving && (
          <form
            className="flex flex-col gap-3"
            action={(fd) => {
              const date = String(fd.get('date') ?? '')
              const to = String(fd.get('received_to') ?? '')
              act(async () => { const r = await markPrivateReceived(receiving.id, date, to || undefined); if (r.ok) setReceiving(null); return r })
            }}
          >
            <p className="text-sm text-text-2">
              {receiving.deal_ref ?? '—'} · {formatMoney(Number(receiving.amount_net))} · דן {formatMoney(Number(receiving.dan_amount))} · ניסים {formatMoney(Number(receiving.nissim_amount))}
            </p>
            <Field label="תאריך קבלה" required><Input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="לאן נכנס" hint="חשבון פרטי — לא חשבון החברה"><Input name="received_to" defaultValue={receiving.received_to ?? ''} /></Field>
            <Button type="submit" variant="primary" disabled={pending}>סמן שהתקבל</Button>
          </form>
        )}
      </DrillDrawer>

      <DrillDrawer open={Boolean(splitting)} onOpenChange={(o) => !o && setSplitting(null)} title={splitting ? `חלוקה — ${splitting.fund_name}` : ''}>
        {splitting && (
          <form
            className="flex flex-col gap-3"
            action={(fd) => {
              const dan = Number(String(fd.get('split_dan') ?? '50'))
              act(async () => { const r = await setPrivateSplit(splitting.id, dan); if (r.ok) setSplitting(null); return r })
            }}
          >
            <Field label="החלק של דן (%)" required hint="השאר לניסים. ברירת המחדל 50/50.">
              <Input name="split_dan" inputMode="decimal" required defaultValue={Math.round(Number(splitting.split_dan) * 100)} />
            </Field>
            <p className="text-xs text-text-3">הסכום {formatMoney(Number(splitting.amount_net))} יתחלק מחדש לפי מה שתזינו.</p>
            <Button type="submit" variant="primary" disabled={pending}>שמור חלוקה</Button>
          </form>
        )}
      </DrillDrawer>
    </div>
  )
}

function RowList({ rows }: { rows: PrivateRow[] }) {
  if (!rows.length) return <p className="text-sm text-text-3">אין שורות</p>
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex justify-between gap-2 py-2">
          <span className="truncate">{r.fund_name} · {r.deal_ref ?? '—'}{r.received_date ? ` · ${formatDate(r.received_date)}` : ''}</span>
          <Money value={Number(r.amount_net)} certainty={r.status === 'received' ? 'actual' : 'expected'} />
        </li>
      ))}
    </ul>
  )
}

function FundList({ summary, who }: { summary: PrivateSummary; who: 'dan' | 'nissim' }) {
  if (!summary.byFund.length) return <p className="text-sm text-text-3">אין שורות</p>
  return (
    <ul className="divide-y divide-border text-sm">
      {summary.byFund.map((f) => (
        <li key={f.fundName} className="flex justify-between gap-2 py-2">
          <span className="truncate">{f.fundName} · {f.rows} שורות</span>
          <span className="tnum">{formatMoney(who === 'dan' ? f.dan : f.nissim)}</span>
        </li>
      ))}
    </ul>
  )
}
