'use client'

import { useRouter } from 'next/navigation'
import { createDeal } from '@/app/actions/deals'
import { ActionDrawerForm } from '@/components/forms/action-form'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FINANCE_STAGE_LABELS, PRODUCT_LABELS } from '@/lib/ui/format'

export function NewDealForm({ trigger }: { trigger: React.ReactNode }) {
  const router = useRouter()
  return (
    <ActionDrawerForm trigger={trigger} title="תיק חדש — מימון" action={createDeal} onSaved={(id) => id && router.push(`/deals/${id}`)}>
      <Field label="שם לקוח" required><Input name="client_name" required autoFocus /></Field>
      <Field label="טלפון"><Input name="client_phone" inputMode="tel" dir="ltr" /></Field>
      <Field label="מוצר" required>
        <Select name="product" required defaultValue="business_credit">
          {['mortgage_declined', 'business_credit', 'vehicle_lien', 'other'].map((p) => <option key={p} value={p}>{PRODUCT_LABELS[p]}</option>)}
        </Select>
      </Field>
      <Field label="שלב">
        <Select name="stage" defaultValue="prospect">
          {Object.entries(FINANCE_STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="שכ״ט שנסגר (ללא מע״מ)"><Input name="fee_agreed_net" inputMode="decimal" dir="ltr" placeholder="0" /></Field>
        <Field label="מקדמה בחתימה" hint="0 בשעבוד רכב"><Input name="advance_at_signing_net" inputMode="decimal" dir="ltr" placeholder="0" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="תאריך חתימה"><Input name="signed_at" type="date" /></Field>
        <Field label="חודש התחשבנות" hint="ריק = חודש התקבול הראשון (§3.4)"><Input name="month_attributed" type="month" /></Field>
      </div>
      <Field label="הערות"><Textarea name="notes" /></Field>
    </ActionDrawerForm>
  )
}
