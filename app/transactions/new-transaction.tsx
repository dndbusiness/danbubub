'use client'

import * as React from 'react'
import { createTransaction } from '@/app/actions/transactions'
import { resolveDailyClose } from '@/app/actions/cashflow'
import { ActionDrawerForm, AmountField } from '@/components/forms/action-form'
import { Field, Input, Select } from '@/components/ui/field'
import { NATURE_LABELS } from '@/lib/ui/format'
import type { AccountRow, CategoryRow } from '@/lib/queries/common'

export function NewTransactionForm({ trigger, categories, accounts, vatRate, defaults }: {
  trigger: React.ReactNode; categories: CategoryRow[]; accounts: AccountRow[]; vatRate: number
  /** קישור עמוק (למשל "סווג" מסגירת יום): נפתח מיד עם סכום/תאריך, ובשמירה סוגר את הסטייה. */
  defaults?: { amount?: number; date?: string; dailyCloseId?: string; open?: boolean }
}) {
  const [nature, setNature] = React.useState('expense')
  const [division, setDivision] = React.useState('finance')
  const [split, setSplit] = React.useState(80)

  return (
    <ActionDrawerForm trigger={trigger} title="תנועה חדשה" action={createTransaction} openOnMount={defaults?.open}
      onSaved={(id) => { if (defaults?.dailyCloseId && id) void resolveDailyClose(defaults.dailyCloseId, { status: 'classified', txId: id, note: 'סווג מסגירת יום' }) }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="תאריך" required><Input name="date_cash" type="date" required defaultValue={defaults?.date ?? new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="חשבון" required><Select name="account_id" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
      </div>
      <Field label="סוג" required>
        <Select name="nature" value={nature} onChange={(e) => setNature(e.target.value)}>
          {Object.entries(NATURE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <AmountField vatRate={vatRate} defaultValue={defaults?.amount} />
      {/* UIUX §4.6 בורר division: שלושה רדיו צבעוניים; "משותף" פותח slider */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-text-2">פעילות</legend>
        <div className="flex gap-2">
          {[['finance', 'מימון', 'accent-div-finance'], ['realestate', 'נדל"ן', 'accent-div-realestate'], ['shared', 'משותף', 'accent-div-shared'], ['private', 'פרטי', 'accent-div-private']].map(([v, l, cls]) => (
            <label key={v} className="inline-flex items-center gap-1 text-sm">
              <input type="radio" name="division" value={v} checked={division === v} onChange={() => setDivision(v!)} className={cls} disabled={nature === 'advance' && v !== 'finance'} /> {l}
            </label>
          ))}
        </div>
        {division === 'shared' && (
          <label className="text-xs text-text-2 flex items-center gap-2">
            מימון {split}% / נדל"ן {100 - split}%
            <input type="range" min={0} max={100} step={5} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="flex-1" />
            <input type="hidden" name="split_finance" value={split / 100} />
          </label>
        )}
      </fieldset>
      {nature === 'expense' && (
        <>
          <Field label="קטגוריה" required>
            <Select name="category_id" required defaultValue="">
              <option value="" disabled>בחר…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="סיווג"><Select name="tx_class" defaultValue="business"><option value="business">עסקי</option><option value="vehicle">רכב</option><option value="private">פרטי</option></Select></Field>
            <Field label="חשבונית"><Select name="invoice_status" defaultValue="unknown"><option value="unknown">לא ידוע</option><option value="has_invoice">יש</option><option value="missing">חסרה</option><option value="no_invoice_needed">לא נדרשת</option></Select></Field>
          </div>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="deductible" defaultChecked /> מוכרת לפעילות (נכנסת לרווח לחלוקה)</label>
        </>
      )}
      <Field label="ספק / לקוח"><Input name="counterparty" /></Field>
      <Field label="תיאור"><Input name="description" /></Field>
    </ActionDrawerForm>
  )
}
