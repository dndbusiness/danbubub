'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { createRealEstateDeal, setRealEstateDealClosed } from '@/app/actions/deals'
import { createTransaction } from '@/app/actions/transactions'
import { ActionDrawerForm, AmountField } from '@/components/forms/action-form'
import { DataTable, type Column } from '@/components/data-table'
import { Money } from '@/components/money'
import { StatusPill } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { formatDate } from '@/lib/ui/format'
import type { RealEstateDealRow } from '@/lib/queries/deals'
import type { AccountRow, CategoryRow } from '@/lib/queries/common'

/**
 * נדל"ן — עסקאות ככסף בלבד (הבהרת דן 18/09/2026).
 * שני מצבים: פוטנציאל / סגור. שכ"ט 2%+מע"מ, עמלת יזם ~1% כולל מע"מ שוטף+30,
 * הוצאות ישירות (עו"ד ~4,000+מע"מ), עמלת מכירה משתנה — כהוצאה ישירה על העסקה.
 */
export function RealEstateDeals({ deals, categories, accounts, vatRate }: {
  deals: RealEstateDealRow[]; categories: CategoryRow[]; accounts: AccountRow[]; vatRate: number
}) {
  const router = useRouter()
  const [, start] = React.useTransition()
  const rows = deals.map((d) => ({ ...d, id: d.deal_id }))
  const [costFor, setCostFor] = React.useState<RealEstateDealRow | null>(null)

  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'client_name', header: 'לקוח' },
    {
      key: 'stage', header: 'סטטוס', value: (r) => r.closed ? 'סגור' : 'פוטנציאל',
      cell: (r) => (
        <StatusPill tone={r.closed ? 'actual' : 'expected'}
          onClick={() => start(async () => { await setRealEstateDealClosed(r.deal_id, !r.closed); router.refresh() })}>
          {r.closed ? 'סגור' : 'פוטנציאל'}
        </StatusPill>
      ),
    },
    { key: 'base_amount', header: 'סכום עסקה', align: 'end', cell: (r) => r.base_amount ? <Money value={r.base_amount} cents={false} /> : '—' },
    { key: 'fee_agreed_net', header: 'שכ״ט (2%)', align: 'end', cell: (r) => <Money value={r.fee_agreed_net} certainty={r.closed ? 'committed' : 'expected'} />, footer: <Money value={rows.reduce((a, r) => a + r.fee_agreed_net, 0)} /> },
    { key: 'developer_commission_net', header: 'עמלת יזם (נטו)', align: 'end', cell: (r) => r.developer_commission_net ? <Money value={r.developer_commission_net} certainty={r.closed ? 'committed' : 'expected'} /> : '—' },
    { key: 'collected_net', header: 'נגבה', align: 'end', cell: (r) => <Money value={r.collected_net} certainty="actual" />, footer: <Money value={rows.reduce((a, r) => a + r.collected_net, 0)} certainty="actual" /> },
    { key: 'open_balance_net', header: 'פתוח', align: 'end', cell: (r) => <Money value={r.open_balance_net} nature={r.open_balance_net > 0 ? 'open' : 'neutral'} /> },
    { key: 'direct_costs_net', header: 'ישירות', align: 'end', cell: (r) => <Money value={r.direct_costs_net} nature="open" /> },
    { key: 'net_contribution', header: 'תרומה', align: 'end', cell: (r) => <Money value={r.net_contribution} /> },
    { key: 'signed_at', header: 'תאריך', value: (r) => r.signed_at ?? r.expected_close_date ?? '', cell: (r) => formatDate(r.signed_at ?? r.expected_close_date) },
    { key: 'cost', header: '', cell: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setCostFor(r) }}>+ הוצאה ישירה</Button> },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <ActionDrawerForm title="עסקת נדל״ן" action={createRealEstateDeal} trigger={<Button variant="primary"><Plus size={16} /> עסקה חדשה</Button>}>
          <input type="hidden" name="vat_rate" value={vatRate} />
          <Field label="שם לקוח" required><Input name="client_name" required autoFocus /></Field>
          <Field label="סכום העסקה (מחיר הדירה)" required><Input name="base_amount" inputMode="decimal" dir="ltr" required placeholder="0" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="שכ״ט % (+ מע״מ)"><Input name="fee_pct" inputMode="decimal" dir="ltr" defaultValue="2" /></Field>
            <Field label="עמלת יזם % (כולל מע״מ)" hint="שוטף+30"><Input name="developer_pct_incl" inputMode="decimal" dir="ltr" defaultValue="1" /></Field>
          </div>
          <Field label="דמי פתיחה (ללא מע״מ)"><Input name="opening_fee_net" inputMode="decimal" dir="ltr" placeholder="0" /></Field>
          <Field label="סטטוס"><Select name="stage" defaultValue="potential"><option value="potential">פוטנציאל</option><option value="closed">לקוח סגור</option></Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="תאריך חתימה"><Input name="signed_at" type="date" /></Field>
            <Field label="צפי סגירה (לפוטנציאל)"><Input name="expected_close_date" type="date" /></Field>
          </div>
          <Field label="הערות"><Textarea name="notes" /></Field>
        </ActionDrawerForm>
      </div>

      <DataTable rows={rows} columns={columns} rowDivision={() => 'realestate'} exportName="realestate-deals"
        primaryKeys={['client_name', 'stage', 'fee_agreed_net']} emptyState="אין עסקאות נדל״ן — הוסף את הראשונה" />

      {/* הוצאה ישירה על עסקה: עו"ד, עמלת מכירה וכו' */}
      {costFor && (
        <ActionDrawerForm title={`הוצאה ישירה — ${costFor.client_name}`} action={createTransaction} trigger={<span />} onSaved={() => setCostFor(null)}>
          <input type="hidden" name="deal_id" value={costFor.deal_id} />
          <input type="hidden" name="nature" value="expense" />
          <input type="hidden" name="division" value="realestate" />
          <input type="hidden" name="deductible" value="on" />
          <Field label="ספק" required><Input name="counterparty" required autoFocus placeholder="עו״ד / איש מכירות" /></Field>
          <AmountField vatRate={vatRate} />
          <Field label="קטגוריה" required>
            <Select name="category_id" required defaultValue="">
              <option value="" disabled>בחר…</option>
              {categories.filter((c) => c.kind === 'direct').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="תאריך" required><Input name="date_cash" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="חשבון" required><Select name="account_id" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          </div>
          <Field label="חשבונית"><Select name="invoice_status" defaultValue="has_invoice"><option value="has_invoice">יש</option><option value="missing">חסרה</option></Select></Field>
        </ActionDrawerForm>
      )}
    </div>
  )
}
