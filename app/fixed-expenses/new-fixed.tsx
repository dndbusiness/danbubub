'use client'

import * as React from 'react'
import { createFixedExpense } from '@/app/actions/fixed-expenses'
import { ActionDrawerForm } from '@/components/forms/action-form'
import { Field, Input, Select } from '@/components/ui/field'
import type { AccountRow, CategoryRow } from '@/lib/queries/common'

export function NewFixedExpenseForm({ trigger, categories, accounts }: { trigger: React.ReactNode; categories: CategoryRow[]; accounts: AccountRow[] }) {
  const [division, setDivision] = React.useState('finance')
  const [split, setSplit] = React.useState(80)
  return (
    <ActionDrawerForm trigger={trigger} title="הוצאה קבועה חדשה" action={createFixedExpense}>
      <Field label="שם" required><Input name="name" required autoFocus placeholder="שכירות משרד" /></Field>
      <Field label="קטגוריה" required>
        <Select name="category_id" required defaultValue=""><option value="" disabled>בחר…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="סכום (ללא מע״מ)" required><Input name="amount_net" inputMode="decimal" dir="ltr" required /></Field>
        <Field label="יום בחודש" required><Input name="day_of_month" type="number" min={1} max={31} required defaultValue={1} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="תדירות"><Select name="frequency" defaultValue="monthly"><option value="monthly">חודשי</option><option value="quarterly">רבעוני</option><option value="yearly">שנתי</option><option value="once">חד-פעמי</option></Select></Field>
        <Field label="חשבון" required><Select name="account_id" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
      </div>
      <Field label="פעילות" required>
        <Select name="division" value={division} onChange={(e) => setDivision(e.target.value)}>
          <option value="finance">מימון</option><option value="realestate">נדל"ן</option><option value="shared">משותף</option>
        </Select>
      </Field>
      {division === 'shared' && (
        <label className="text-xs text-text-2 flex items-center gap-2">
          מימון {split}% / נדל"ן {100 - split}%
          <input type="range" min={0} max={100} step={5} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="flex-1" />
          <input type="hidden" name="split_finance" value={split / 100} />
        </label>
      )}
      <Field label="תאריך התחלה" required><Input name="start_date" type="date" required defaultValue={new Date().toISOString().slice(0, 8) + '01'} /></Field>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="variable" /> סכום משתנה (למשל חיוב אשראי)</label>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="approved_by_nissim" /> מאושר 50/50 (SPEC §3.3)</label>
    </ActionDrawerForm>
  )
}
