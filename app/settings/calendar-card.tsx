'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Play } from 'lucide-react'
import { runCalendarSyncNow, saveSettings } from '@/app/actions/settings'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'

/** ב.2 — יומן: לאילו יומנים כותבים, מי המשתתפים, ימי המפתח. הכתיבה עצמה דרך outbox. */
export function CalendarCard({ values, calendarConnected }: { values: Record<string, unknown>; calendarConnected: boolean }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [msg, setMsg] = React.useState<string | null>(null)
  const v = (k: string) => { const x = values[k]; return Array.isArray(x) ? x.join(', ') : x == null ? '' : String(x) }
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => start(async () => { const r = await fn(); setMsg(r.ok ? done : r.error); router.refresh() })
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><CalendarDays size={18} className="text-text-2" /><h2 className="font-semibold">יומן ואנשים</h2><span className="text-xs text-text-3">ADDENDUM ב.2 · אירועים ל-60 יום, [כספים] + rule_key, דרך outbox</span></div>
      <form action={(fd) => run(() => saveSettings(fd), 'ההגדרות נשמרו')} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="יומנים (מזהים, מופרדים בפסיק)" hint='ברירת מחדל: primary. יומן הר-אל: כתובת היומן מהגדרות Google'><Input name="calendar_ids" defaultValue={v('calendar_ids')} dir="ltr" placeholder="primary, harel@group.calendar.google.com" /></Field>
        <Field label="מייל ניסים"><Input name="notify_email_nissim" type="email" defaultValue={v('notify_email_nissim')} dir="ltr" /></Field>
        <Field label="מייל הדס"><Input name="notify_email_hadas" type="email" defaultValue={v('notify_email_hadas')} dir="ltr" /></Field>
        <Field label="מייל אביב" hint="דוח שבועי — נדל״ן בלבד"><Input name="notify_email_aviv" type="email" defaultValue={v('notify_email_aviv')} dir="ltr" /></Field>
        <Field label='מייל רו"ח' hint="P&L סופי וחומר הסגירה ב-12 לחודש"><Input name="accountant_email" type="email" defaultValue={v('accountant_email')} dir="ltr" /></Field>
        <Field label="יום תשלום שכר" hint="ברירת מחדל 9"><Input name="payroll_pay_day" type="number" min={1} max={31} defaultValue={v('payroll_pay_day')} /></Field>
        <Field label="יום אישור שכר" hint="ברירת מחדל 27"><Input name="payroll_approval_day" type="number" min={1} max={31} defaultValue={v('payroll_approval_day')} /></Field>
        <Field label="סגירה לרו״ח — יום" hint="ברירת מחדל 12"><Input name="accountant_close_day" type="number" min={1} max={31} defaultValue={v('accountant_close_day')} /></Field>
        <Field label="דיווח מע״מ — יום" hint="ברירת מחדל 15"><Input name="vat_day" type="number" min={1} max={31} defaultValue={v('vat_day')} /></Field>
        <label className="inline-flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" name="vat_bimonthly" defaultChecked={values.vat_bimonthly === true} /> מע״מ דו-חודשי</label>
        <Field label="כתובת קליטת הוצאות — חשבונית ירוקה" hint="ב.3 שלב 6: כל חשבונית מאושרת מועברת לשם"><Input name="greeninvoice_intake_email" type="email" defaultValue={v('greeninvoice_intake_email')} dir="ltr" /></Field>
        <div className="sm:col-span-3 flex flex-wrap gap-2 items-center">
          <Button type="submit" variant="primary" disabled={pending}>שמור</Button>
          <Button type="button" disabled={pending} onClick={() => run(async () => { const r = await runCalendarSyncNow(); if (r.ok) setMsg(`תוכננו ${r.planned} אירועים · ${r.queued} חדשים/שונו ב-outbox${r.skipped ? ` · ${r.skipped}` : ''}`); return r.ok ? { ok: true } : r }, '')}>
            <Play size={16} /> סנכרן יומן עכשיו
          </Button>
          {!calendarConnected && <span className="text-xs text-open">היומן לא מחובר (calendar.events) — האירועים ימתינו ב-outbox</span>}
        </div>
      </form>
      {msg && <p className="text-sm text-text-2" role="status">{msg}</p>}
    </Card>
  )
}
