'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'
import { addPaymentPlan, setChecklistItem } from '@/app/actions/deals'
import { createTransaction } from '@/app/actions/transactions'
import { ActionDrawerForm, AmountField } from '@/components/forms/action-form'
import { DataTable, type Column } from '@/components/data-table'
import { Money } from '@/components/money'
import { CertaintyPill, InvoicePill, StatusPill } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { NATURE_LABELS, formatDate } from '@/lib/ui/format'
import type { DealActivityRow, DealChecklistRow, DealPaymentRow, DealRow, DealTxRow } from '@/lib/queries/deals'
import type { AccountRow, CategoryRow } from '@/lib/queries/common'
import { cn } from '@/lib/ui/cn'

const TABS = ['תקבולים', 'הוצאות ישירות', 'צ׳קליסט ביצוע', 'הגשות', 'מסמכים', 'פעילות'] as const

export function DealTabs({ deal, payments, txs, checklist, activity, categories, accounts, vatRate }: {
  deal: DealRow; payments: DealPaymentRow[]; txs: DealTxRow[]; checklist: DealChecklistRow[]
  activity: DealActivityRow[]; categories: CategoryRow[]; accounts: AccountRow[]; vatRate: number
}) {
  const [tab, setTab] = React.useState<(typeof TABS)[number]>('תקבולים')
  const [, start] = React.useTransition()

  const paymentCols: Column<DealPaymentRow>[] = [
    { key: 'label', header: 'תיאור' },
    { key: 'expected_date', header: 'תאריך צפוי', cell: (r) => formatDate(r.expected_date) },
    { key: 'certainty', header: 'ודאות', cell: (r) => <CertaintyPill certainty={r.certainty} /> },
    { key: 'probability', header: 'הסתברות', cell: (r) => `${Math.round(r.probability * 100)}%` },
    { key: 'amount_net', header: 'סכום', align: 'end', cell: (r) => <Money value={r.amount_net} certainty={r.matched_tx_id ? 'actual' : r.certainty} /> },
    { key: 'matched_tx_id', header: 'שודך', cell: (r) => r.matched_tx_id ? <StatusPill tone="actual">נכנס בפועל</StatusPill> : <span className="text-text-3 text-xs">—</span> },
  ]
  const incomeTxs = txs.filter((t) => t.nature === 'income')
  const expenseTxs = txs.filter((t) => t.nature === 'expense')
  const txCols: Column<DealTxRow>[] = [
    { key: 'date_cash', header: 'תאריך', cell: (r) => formatDate(r.date_cash) },
    { key: 'counterparty', header: 'ספק / לקוח' },
    { key: 'category_name', header: 'קטגוריה' },
    { key: 'description', header: 'תיאור' },
    { key: 'invoice_status', header: 'חשבונית', cell: (r) => <InvoicePill status={r.invoice_status} /> },
    { key: 'amount_net', header: 'סכום', align: 'end', cell: (r) => <Money value={r.amount_net} certainty="actual" vat={{ net: r.amount_net, vat: r.vat_amount, gross: r.amount_gross }} /> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('px-3 h-10 text-sm whitespace-nowrap border-b-2 -mb-px', tab === t ? 'border-brand text-text font-medium' : 'border-transparent text-text-2')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'תקבולים' && (
        <div className="flex flex-col gap-3">
          <div className="flex justify-end">
            <ActionDrawerForm title="תקבול צפוי" action={addPaymentPlan} trigger={<Button size="sm"><Plus size={14} /> שורה ללוח</Button>}>
              <input type="hidden" name="deal_id" value={deal.deal_id} />
              <Field label="תיאור" required><Select name="label" required defaultValue="יתרה"><option>מקדמה בחתימה</option><option>success fee</option><option>יתרה</option></Select></Field>
              <Field label="סכום (ללא מע״מ)" required><Input name="amount_net" inputMode="decimal" dir="ltr" required /></Field>
              <Field label="תאריך צפוי" required><Input name="expected_date" type="date" required /></Field>
              <Field label="ודאות"><Select name="certainty" defaultValue="expected"><option value="committed">ודאי</option><option value="expected">פוטנציאל</option></Select></Field>
              <Field label="הסתברות (לפוטנציאל)" hint="0–1; ריק = לפי שלב"><Input name="probability" inputMode="decimal" dir="ltr" placeholder="0.5" /></Field>
            </ActionDrawerForm>
          </div>
          <DataTable rows={payments} columns={paymentCols} exportName={`deal-${deal.deal_id}-payments`} emptyState="אין תקבולים צפויים — הוסף שורה ללוח" />
          {incomeTxs.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-text-2 mt-2">נכנס בפועל</h3>
              <DataTable rows={incomeTxs} columns={txCols} exportName={`deal-${deal.deal_id}-income`} />
            </>
          )}
        </div>
      )}

      {tab === 'הוצאות ישירות' && (
        <div className="flex flex-col gap-3">
          <div className="flex justify-end">
            {/* UIUX §5.2 "הוספה בשורה אחת: ספק, סכום, מע"מ, חשבונית ✓/✗" */}
            <ActionDrawerForm title="הוצאה ישירה לתיק" action={createTransaction} trigger={<Button size="sm"><Plus size={14} /> הוצאה ישירה</Button>}>
              <input type="hidden" name="deal_id" value={deal.deal_id} />
              <input type="hidden" name="nature" value="expense" />
              <input type="hidden" name="division" value="finance" />
              <input type="hidden" name="deductible" value="on" />
              <Field label="ספק" required><Input name="counterparty" required autoFocus /></Field>
              <AmountField vatRate={vatRate} />
              <Field label="קטגוריה" required>
                <Select name="category_id" required defaultValue="">
                  <option value="" disabled>בחר…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="תאריך" required><Input name="date_cash" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
                <Field label="חשבון" required><Select name="account_id" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
              </div>
              <Field label="חשבונית"><Select name="invoice_status" defaultValue="has_invoice"><option value="has_invoice">יש</option><option value="missing">חסרה</option><option value="no_invoice_needed">לא נדרשת</option></Select></Field>
              <Field label="תיאור"><Input name="description" /></Field>
            </ActionDrawerForm>
          </div>
          <DataTable rows={expenseTxs} columns={txCols} exportName={`deal-${deal.deal_id}-costs`} emptyState="אין הוצאות ישירות על התיק" />
        </div>
      )}

      {tab === 'צ׳קליסט ביצוע' && (
        <ul className="flex flex-col gap-2">
          {checklist.length === 0 && <li className="text-sm text-text-2">אין צ׳קליסט לתיק — נוצר אוטומטית לתיקים חדשים לפי המוצר (ADDENDUM ב.5)</li>}
          {checklist.map((item) => (
            <li key={item.id} className={cn('flex items-center gap-3 bg-surface rounded-[var(--radius-card)] px-4 py-3 shadow-[var(--shadow-card)]', item.status === 'done' && 'opacity-60')}>
              <span className="text-xs text-text-3 tnum w-5">{item.sort_order}</span>
              <span className={cn('flex-1 text-sm', item.status === 'done' && 'line-through')}>{item.label}</span>
              {item.status === 'blocked' && <span className="text-xs text-open">{item.blocked_reason}</span>}
              {item.status_since && item.status !== 'done' && <span className="text-xs text-text-3">מ-{formatDate(item.status_since)}</span>}
              <select
                value={item.status}
                onChange={(e) => {
                  const status = e.target.value
                  const reason = status === 'blocked' ? (window.prompt('סיבת החסימה?') ?? undefined) : undefined
                  start(async () => { await setChecklistItem(item.id, deal.deal_id, status, reason) })
                }}
                className="h-8 rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-xs"
              >
                <option value="pending">ממתין</option><option value="done">בוצע</option><option value="blocked">חסום</option><option value="n/a">לא רלוונטי</option>
              </select>
            </li>
          ))}
        </ul>
      )}

      {tab === 'הגשות' && <Empty>הגשות לבנקים מיובאות מ-WISE (SPEC §4.5) — שלב 8.</Empty>}
      {tab === 'מסמכים' && <Empty>חשבוניות ומסמכים מקושרים — נכנסים עם ייבוא חשבונית ירוקה (שלב 6).</Empty>}

      {tab === 'פעילות' && (
        <ul className="flex flex-col gap-1 text-sm">
          {activity.length === 0 && <li className="text-text-2">אין פעילות עדיין</li>}
          {activity.map((a) => (
            <li key={a.id} className="flex gap-3 py-2 border-b border-border last:border-0">
              <span className="text-xs text-text-3 tnum whitespace-nowrap">{a.changed_at}</span>
              <span className="text-xs text-text-2">{a.actor ?? 'מערכת'}</span>
              <span>{({ INSERT: 'נוסף', UPDATE: 'עודכן', DELETE: 'נמחק' })[a.action] ?? a.action} · {({ deals: 'תיק', transactions: 'תנועה', deal_payments_plan: 'תקבול צפוי', deal_checklist_items: 'צ׳קליסט' })[a.table_name] ?? a.table_name}</span>
              {a.summary && <span className="text-text-2 truncate">{a.summary}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface rounded-[var(--radius-card)] border border-border p-8 text-center text-sm text-text-2">{children}</div>
}

export { NATURE_LABELS }
