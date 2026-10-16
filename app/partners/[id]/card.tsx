'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/status-pill'
import { DataTable, type Column } from '@/components/data-table'
import type { DrawRow, InvestorLoanRow, PartnerPositionRow, RealEstateMonthRow } from '@/lib/queries/partners'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'
import { DRAW_LABEL } from '../client'

const COUNTED = new Set(['salary', 'management_fee', 'dividend'])

/** מסך 8 — "החלק שלי": מה שאביב או יוני רואים, בלי המספרים של האחרים. */
export function PartnerCard({ year, years, name, payMethod, position, draws, months, loan, partnerCount }: {
  year: string
  years: string[]
  partnerId: string
  name: string
  payMethod: string
  position: PartnerPositionRow | null
  draws: DrawRow[]
  months: RealEstateMonthRow[]
  loan: InvestorLoanRow | null
  partnerCount: number
}) {
  const router = useRouter()
  const params = useSearchParams()
  const target = Number(position?.target ?? 0)
  const drawn = Number(position?.drawn ?? 0)
  const variance = Number(position?.variance ?? 0)
  const profit = Number(position?.distributable_profit ?? 0)
  const pct = target > 0 ? Math.min(100, Math.round((drawn / target) * 100)) : 0

  const setYear = (y: string) => {
    const next = new URLSearchParams(params.toString())
    next.set('year', y)
    router.push(`?${next.toString()}`)
  }

  const columns: Column<DrawRow>[] = [
    { key: 'date', header: 'תאריך', cell: (d) => formatDate(d.date) },
    { key: 'type', header: 'סוג', value: (d) => d.type, cell: (d) => <StatusPill tone={COUNTED.has(d.type) ? 'actual' : 'locked'}>{DRAW_LABEL[d.type] ?? d.type}</StatusPill> },
    { key: 'amount', header: 'סכום', align: 'end', value: (d) => Number(d.amount), cell: (d) => <Money value={Number(d.amount)} />, footer: <Money value={draws.reduce((a, d) => a + Number(d.amount), 0)} /> },
    { key: 'includes_employer_cost', header: 'כולל עלות מעביד', mobileHidden: true, value: (d) => (d.includes_employer_cost ? 'כן' : 'לא'), cell: (d) => d.includes_employer_cost ? <StatusPill tone="expected">כן</StatusPill> : <span className="text-text-3">—</span> },
    { key: 'note', header: 'הערה', mobileHidden: true, cell: (d) => <span className="text-xs text-text-3">{d.note ?? '—'}</span> },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-2">שנה</span>
        {years.map((y) => (
          <button key={y} type="button" onClick={() => setYear(y)}
            className={cn('px-3 py-1 rounded-[var(--radius-btn)] border border-border text-sm', y === year && 'bg-locked-bg font-medium')}>{y}</button>
        ))}
        <span className="text-xs text-text-3 ms-auto">
          {payMethod === 'payslip' ? 'תשלום בתלוש — עלות המעביד היא מה שנספר כמשיכה (§3.5)' : 'תשלום בחשבונית — נספר הסכום ללא מע״מ (§3.5)'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard title="היעד שלי" value={target} certainty="committed"
          subtitle={`רווח לחלוקה ${formatMoney(profit)} ÷ ${partnerCount} שותפים`}
          drillTitle="הרווח לפי חודש"
          drill={<ul className="divide-y divide-border text-sm">{months.map((m) => <li key={m.month} className="flex justify-between py-2"><span>{m.month}</span><Money value={Number(m.profit)} /></li>)}{!months.length && <li className="py-2 text-text-3">אין פעילות ב-{year}</li>}</ul>} />
        <KpiCard title="משכתי" value={drawn} certainty="actual"
          subtitle={`${draws.filter((d) => COUNTED.has(d.type)).length} משיכות · ${pct}% מהיעד`}
          drillTitle="המשיכות שלי" drill={<List rows={draws.filter((d) => COUNTED.has(d.type))} />} />
        <KpiCard title={variance > 0 ? 'משכתי מעבר ליעד' : 'נשאר לי למשוך'} value={Math.abs(variance)}
          nature={variance > 0 ? 'open' : undefined} certainty={variance > 0 ? undefined : 'committed'}
          subtitle={Math.abs(variance) < 0.01 ? 'מאוזן מול השותפים' : variance > 0 ? 'ההפרש מתקזז מול המשיכות הבאות' : 'עד שמגיעים ליעד השוויוני'}
          drillTitle="איך זה מחושב"
          drill={
            <ul className="text-sm flex flex-col gap-2">
              <li className="flex justify-between"><span>רווח לחלוקה {year}</span><Money value={profit} /></li>
              <li className="flex justify-between"><span>חלקי {partnerCount} שותפים = היעד</span><Money value={target} /></li>
              <li className="flex justify-between"><span>משכתי בפועל</span><Money value={drawn} /></li>
              <li className="flex justify-between border-t border-border pt-2 font-medium"><span>סטייה</span><Money value={variance} nature={variance > 0 ? 'open' : undefined} /></li>
            </ul>
          } />
      </div>

      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">התקדמות מול היעד</span>
          <span className="text-text-2 tnum">{formatMoney(drawn)} / {formatMoney(target)}</span>
        </div>
        <span className="block h-3 bg-locked-bg rounded">
          <span className={cn('block h-3 rounded', variance > 0 ? 'bg-open' : 'bg-actual')} style={{ width: `${pct}%` }} />
        </span>
        <p className="text-xs text-text-3">
          היעד מצטבר מתחילת השנה ומשתנה עם כל חודש שנסגר — הוא לא הבטחה לתשלום אלא החלק השווה ברווח שכבר נוצר.
        </p>
      </Card>

      {position && Number(position.owner_loan_balance) !== 0 && (
        <Card className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">חו״ז בעלים</span>
          <Money value={Number(position.owner_loan_balance)} />
          <span className="text-text-2 text-xs">
            הלוואות {formatMoney(Number(position.owner_loans))} · החזרים {formatMoney(Number(position.loan_repayments))} — לא נספר כמשיכה מול היעד
          </span>
        </Card>
      )}

      {loan && (
        <Card className="flex flex-wrap items-center gap-3 text-sm border-s-4 border-s-open">
          <span className="font-medium">חוב משקיע</span>
          <Money value={Number(loan.balance)} nature={Number(loan.balance) > 0 ? 'open' : undefined} />
          <span className="text-text-2 text-xs">
            מתוך {formatMoney(Number(loan.opening_balance))} · הוחזר {formatMoney(Number(loan.repaid))}
            {loan.months_to_clear ? ` · בקצב הנוכחי ייסגר בעוד ${loan.months_to_clear} חודשים` : ''}
          </span>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">כל התנועות שלי — {year}</h2>
        <DataTable rows={draws} columns={columns} exportName={`${name}-${year}`}
          primaryKeys={['date', 'type', 'amount']} emptyState="לא נרשמו משיכות בשנה הזו" initialSort={{ key: 'date', dir: 'desc' }} />
      </section>
    </div>
  )
}

function List({ rows }: { rows: DrawRow[] }) {
  if (!rows.length) return <p className="text-sm text-text-3">אין שורות</p>
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((d) => (
        <li key={d.id} className="flex justify-between gap-2 py-2">
          <span className="truncate">{formatDate(d.date)} · {DRAW_LABEL[d.type] ?? d.type}</span>
          <Money value={Number(d.amount)} />
        </li>
      ))}
    </ul>
  )
}
