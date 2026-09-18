'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Banknote, HandCoins, Plus, Scale, Trash2, Wallet } from 'lucide-react'
import { addPartnerDraw, deletePartnerDraw, setInvestorLoanOpening } from '@/app/actions/partners'
import { ActionDrawerForm } from '@/components/forms/action-form'
import { DataTable, type Column } from '@/components/data-table'
import { DrillDrawer } from '@/components/drill-drawer'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { StatusPill } from '@/components/status-pill'
import type { CashDiscountRow, DrawRow, InvestorLoanRow, PartnerPositionRow, RealEstateMonthRow } from '@/lib/queries/partners'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

export const DRAW_LABEL: Record<string, string> = {
  salary: 'שכר',
  management_fee: 'דמי ניהול',
  dividend: 'דיבידנד',
  owner_loan: 'הלוואת בעלים',
  loan_repayment: 'החזר הלוואה',
}
/** §3.5 — רק שלושת אלה נספרים כמשיכה מול היעד. */
const COUNTED = new Set(['salary', 'management_fee', 'dividend'])

export function PartnersView({ year, years, positions, months, draws, loans, cashDiscount, partners }: {
  year: string
  years: string[]
  positions: PartnerPositionRow[]
  months: RealEstateMonthRow[]
  draws: DrawRow[]
  loans: InvestorLoanRow[]
  cashDiscount: CashDiscountRow[]
  partners: { id: string; name: string; pay_method: string; investor_loan_opening: number; investor_loan_note: string | null }[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [drill, setDrill] = React.useState<{ title: string; rows: DrawRow[] } | null>(null)
  const [loanFor, setLoanFor] = React.useState<{ id: string; name: string; current: number } | null>(null)

  const profit = Number(positions[0]?.distributable_profit ?? 0)
  const totalDrawn = positions.reduce((a, p) => a + Number(p.drawn), 0)
  const openBalance = positions.reduce((a, p) => a + Number(p.owner_loan_balance), 0)

  const setYear = (y: string) => {
    const next = new URLSearchParams(params.toString())
    next.set('year', y)
    router.push(`/partners?${next.toString()}`)
  }
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => { const r = await fn(); if (!r.ok) { setError(r.error); return } setError(null); router.refresh() })

  const positionColumns: Column<PartnerPositionRow & { id: string }>[] = [
    {
      key: 'name', header: 'שותף',
      cell: (p) => (
        <Link href={`/partners/${p.partner_id}?year=${year}`} className="font-medium underline" onClick={(e) => e.stopPropagation()}>
          {p.name}
        </Link>
      ),
    },
    { key: 'pay_method', header: 'אופן תשלום', mobileHidden: true, cell: (p) => <span className="text-xs text-text-2">{p.pay_method === 'payslip' ? 'תלוש (עלות מעביד נספרת)' : 'חשבונית (ללא מע״מ)'}</span> },
    { key: 'target', header: 'יעד שוויוני', align: 'end', value: (p) => Number(p.target), cell: (p) => <Money value={Number(p.target)} certainty="committed" />, footer: <Money value={positions.reduce((a, p) => a + Number(p.target), 0)} /> },
    {
      key: 'drawn', header: 'נמשך בפועל', align: 'end', value: (p) => Number(p.drawn),
      cell: (p) => (
        <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); setDrill({ title: `משיכות ${p.name} ${year}`, rows: draws.filter((d) => d.partner_id === p.partner_id && COUNTED.has(d.type)) }) }}>
          <Money value={Number(p.drawn)} certainty="actual" />
        </button>
      ),
      footer: <Money value={totalDrawn} />,
    },
    {
      key: 'variance', header: 'סטייה מהיעד', align: 'end', value: (p) => Number(p.variance),
      cell: (p) => {
        const v = Number(p.variance)
        return (
          <span className="inline-flex items-center gap-1">
            <Money value={v} nature={Math.abs(v) < 0.01 ? undefined : v > 0 ? 'open' : undefined} />
            <StatusPill tone={Math.abs(v) < 0.01 ? 'actual' : v > 0 ? 'open' : 'expected'}>
              {Math.abs(v) < 0.01 ? 'מאוזן' : v > 0 ? 'משך יותר' : 'משך פחות'}
            </StatusPill>
          </span>
        )
      },
    },
    {
      key: 'owner_loan_balance', header: 'חו״ז בעלים', align: 'end', value: (p) => Number(p.owner_loan_balance),
      cell: (p) => (
        <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); setDrill({ title: `חו״ז ${p.name} ${year}`, rows: draws.filter((d) => d.partner_id === p.partner_id && !COUNTED.has(d.type)) }) }}>
          <Money value={Number(p.owner_loan_balance)} />
        </button>
      ),
      footer: <Money value={openBalance} />,
    },
  ]

  const drawColumns: Column<DrawRow>[] = [
    { key: 'date', header: 'תאריך', cell: (d) => formatDate(d.date) },
    { key: 'partner_name', header: 'שותף' },
    { key: 'type', header: 'סוג', value: (d) => d.type, cell: (d) => <StatusPill tone={COUNTED.has(d.type) ? 'actual' : 'locked'}>{DRAW_LABEL[d.type] ?? d.type}</StatusPill> },
    { key: 'amount', header: 'סכום', align: 'end', value: (d) => Number(d.amount), cell: (d) => <Money value={Number(d.amount)} />, footer: <Money value={draws.reduce((a, d) => a + Number(d.amount), 0)} /> },
    { key: 'includes_employer_cost', header: 'כולל עלות מעביד', mobileHidden: true, value: (d) => (d.includes_employer_cost ? 'כן' : 'לא'), cell: (d) => d.includes_employer_cost ? <StatusPill tone="expected">כולל עלות מעביד</StatusPill> : <span className="text-text-3">—</span> },
    { key: 'note', header: 'הערה', mobileHidden: true, cell: (d) => <span className="text-xs text-text-3">{d.note ?? '—'}</span> },
    {
      key: 'actions', header: '',
      cell: (d) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" disabled={pending} title="בטל שורה"
            onClick={() => { if (confirm(`לבטל את השורה של ${d.partner_name} (${formatMoney(Number(d.amount))})?`)) act(() => deletePartnerDraw(d.id)) }}>
            <Trash2 size={14} />
          </Button>
        </span>
      ),
    },
  ]

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-2">שנה</span>
        {years.map((y) => (
          <button key={y} type="button" onClick={() => setYear(y)}
            className={cn('px-3 py-1 rounded-[var(--radius-btn)] border border-border text-sm', y === year && 'bg-locked-bg font-medium')}>
            {y}
          </button>
        ))}
        <span className="ms-auto">
          <ActionDrawerForm
            title="רישום משיכה / חו״ז"
            action={addPartnerDraw}
            submitLabel="רשום"
            trigger={<Button variant="primary" type="button"><Plus size={16} /> משיכה חדשה</Button>}
          >
            <Field label="שותף" required>
              <Select name="partner_id" required>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="תאריך" required><Input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
              <Field label="סכום" required hint="בשקלים"><Input name="amount" inputMode="decimal" required /></Field>
            </div>
            <Field label="סוג" required hint="שכר / דמי ניהול / דיבידנד נספרים מול היעד. הלוואה והחזר הם חו״ז.">
              <Select name="type" required defaultValue="management_fee">
                {Object.entries(DRAW_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="includes_employer_cost" />
              הסכום כולל עלות מעביד (תלוש — §3.5)
            </label>
            <Field label="הערה"><Textarea name="note" rows={2} /></Field>
          </ActionDrawerForm>
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard title={`רווח לחלוקה ${year}`} value={profit} certainty="actual"
          subtitle={`${months.length === 1 ? 'חודש אחד' : `${months.length} חודשים`} עם פעילות · היעד לכל שותף ${formatMoney(Number(positions[0]?.target ?? 0))}`}
          drillTitle="לפי חודש"
          drill={<ul className="divide-y divide-border text-sm">{months.map((m) => <li key={m.month} className="flex justify-between py-2"><span>{m.month} · הכנסות {formatMoney(Number(m.income))} · הוצאות {formatMoney(Number(m.expenses))}</span><Money value={Number(m.profit)} /></li>)}{!months.length && <li className="py-2 text-text-3">אין עדיין פעילות נדל״ן ב-{year}</li>}</ul>} />
        <KpiCard title="נמשך בפועל" value={totalDrawn} certainty="actual"
          subtitle={`${draws.filter((d) => COUNTED.has(d.type)).length} משיכות · נשאר לחלוקה ${formatMoney(profit - totalDrawn)}`}
          drillTitle="כל המשיכות" drill={<DrawList rows={draws.filter((d) => COUNTED.has(d.type))} />} />
        <KpiCard title="חו״ז בעלים" value={openBalance} nature={openBalance ? 'open' : undefined}
          subtitle="הלוואות בעלים פחות החזרים — לא נספר כמשיכה"
          drillTitle="חו״ז" drill={<DrawList rows={draws.filter((d) => !COUNTED.has(d.type))} />} />
      </div>

      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Scale size={16} className="text-text-2" />
          <h2 className="font-semibold">33/33/33 — מי משך כמה מול היעד</h2>
        </div>
        <DataTable rows={positions.map((p) => ({ ...p, id: p.partner_id }))} columns={positionColumns} exportName={`partners-${year}`}
          primaryKeys={['name', 'drawn', 'variance']} emptyState="אין שותפי נדל״ן פעילים" />
        {!months.length && (
          <Card className="text-sm text-text-2">
            אין עדיין תנועות נדל״ן ב-{year} — הרווח לחלוקה 0, ולכן גם היעד. המסך יתמלא ברגע
            שתנועות עם <span className="font-medium">פעילות נדל״ן</span> ייכנסו (ייבוא או הזנה ידנית).
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Banknote size={16} className="text-text-2" />
          <h2 className="font-semibold">חוב משקיע</h2>
          <span className="text-xs text-text-3">§3.5 — יתרת פתיחה פחות החזרים, עם קצב הירידה</span>
        </div>
        {loans.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loans.map((l) => (
              <Card key={l.partner_id} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{l.name}</span>
                  <StatusPill tone={Number(l.balance) > 0 ? 'open' : 'actual'}>{Number(l.balance) > 0 ? 'פתוח' : 'נסגר'}</StatusPill>
                  <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setLoanFor({ id: l.partner_id, name: l.name, current: Number(l.opening_balance) })}>עדכן פתיחה</Button>
                </div>
                <div className="flex items-baseline gap-2">
                  <Money value={Number(l.balance)} size="lg" nature={Number(l.balance) > 0 ? 'open' : undefined} />
                  <span className="text-xs text-text-3">מתוך {formatMoney(Number(l.opening_balance))} · הוחזר {formatMoney(Number(l.repaid))}</span>
                </div>
                <p className="text-xs text-text-2">
                  {l.average_monthly_repayment
                    ? `קצב החזר ${formatMoney(Number(l.average_monthly_repayment))} לחודש${l.months_to_clear ? ` · ייסגר בעוד ${l.months_to_clear} חודשים` : ''}`
                    : 'טרם נרשם החזר — אין קצב לחשב לפיו'}
                  {l.last_repayment ? ` · אחרון ${formatDate(l.last_repayment)}` : ''}
                </p>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="flex flex-wrap items-center gap-3 text-sm text-text-2">
            <HandCoins size={16} />
            לא הוזנה יתרת פתיחה לאף שותף. האפיון (§3.5) מציין חוב של 200,000 ₪ ליוני —
            <span className="font-medium">המערכת לא כותבת את המספר לבד</span> (שאלה פתוחה #8).
            <span className="ms-auto flex gap-2">
              {partners.map((p) => (
                <Button key={p.id} size="sm" variant="secondary" onClick={() => setLoanFor({ id: p.id, name: p.name, current: Number(p.investor_loan_opening) })}>
                  הזן ל{p.name}
                </Button>
              ))}
            </span>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-text-2" />
          <h2 className="font-semibold">כל התנועות בין השותפים — {year}</h2>
        </div>
        <DataTable rows={draws} columns={drawColumns} exportName={`partner-draws-${year}`}
          primaryKeys={['date', 'partner_name', 'amount']} emptyState="לא נרשמו משיכות בשנה הזו" initialSort={{ key: 'date', dir: 'desc' }} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">נכיון מזומן</h2>
        <p className="text-xs text-text-3">§3.5 — מוצג בנפרד ולעולם לא מוסתר מהדוח.</p>
        {cashDiscount.length ? (
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead className="text-xs text-text-2 bg-locked-bg"><tr><th className="text-start p-2">תאריך</th><th className="text-start p-2">מי</th><th className="text-end p-2">נטו</th><th className="text-end p-2">ברוטו</th></tr></thead>
              <tbody>
                {cashDiscount.map((c) => (
                  <tr key={c.tx_id} className="border-t border-border">
                    <td className="p-2">{formatDate(c.date)}</td>
                    <td className="p-2">{c.counterparty ?? c.description ?? '—'}</td>
                    <td className="p-2 text-end"><Money value={Number(c.amount_net)} /></td>
                    <td className="p-2 text-end tnum text-text-2">{formatMoney(Number(c.amount_gross))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : <Card className="text-sm text-text-3">אין תנועות נכיון מזומן ב-{year}.</Card>}
      </section>

      <DrillDrawer open={Boolean(drill)} onOpenChange={(o) => !o && setDrill(null)} title={drill?.title ?? ''}>
        <DrawList rows={drill?.rows ?? []} />
      </DrillDrawer>

      <DrillDrawer open={Boolean(loanFor)} onOpenChange={(o) => !o && setLoanFor(null)} title={loanFor ? `יתרת פתיחה — ${loanFor.name}` : ''}>
        {loanFor && (
          <form
            className="flex flex-col gap-3"
            action={(fd) => {
              const amount = Number(String(fd.get('amount') ?? '').replace(/[,\s₪]/g, ''))
              const note = String(fd.get('note') ?? '')
              act(async () => { const r = await setInvestorLoanOpening(loanFor.id, amount, note || undefined); if (r.ok) setLoanFor(null); return r })
            }}
          >
            <Field label="יתרת פתיחה" required hint="האפיון §3.5 מציין 200,000 ₪ ליוני — לאשר או להקליד את הסכום הנכון">
              <Input name="amount" inputMode="decimal" required defaultValue={loanFor.current || ''} />
            </Field>
            <Field label="מקור החוב" hint="שאלה #8 — מאיפה הכסף וקצב ההחזר המוסכם">
              <Textarea name="note" rows={3} />
            </Field>
            <Button type="submit" variant="primary" disabled={pending}>שמור</Button>
          </form>
        )}
      </DrillDrawer>
    </div>
  )
}

export function DrawList({ rows }: { rows: DrawRow[] }) {
  if (!rows.length) return <p className="text-sm text-text-3">אין שורות</p>
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((d) => (
        <li key={d.id} className="flex justify-between gap-2 py-2">
          <span className="truncate">{formatDate(d.date)} · {d.partner_name} · {DRAW_LABEL[d.type] ?? d.type}{d.includes_employer_cost ? ' (כולל עלות מעביד)' : ''}</span>
          <Money value={Number(d.amount)} />
        </li>
      ))}
      <li className="flex justify-between pt-2 font-medium"><span>סה״כ</span><Money value={rows.reduce((a, d) => a + Number(d.amount), 0)} /></li>
    </ul>
  )
}
