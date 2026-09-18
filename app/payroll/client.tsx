'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Download, FileText, Plus, RotateCcw, Users, Wallet } from 'lucide-react'
import {
  addEmployee, addEmploymentTerms, addPayrollAdjustment, approvePayroll,
  markPayrollPaid, reopenPayroll, setPayrollInputs,
} from '@/app/actions/payroll'
import { ActionDrawerForm } from '@/components/forms/action-form'
import { DrillDrawer } from '@/components/drill-drawer'
import { KpiCard } from '@/components/kpi-card'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { StatusPill } from '@/components/status-pill'
import type { PayrollLine, PayrollTotals, TermsRow } from '@/lib/queries/payroll'
import { formatMoney, formatMonth } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

const PAY_TYPE: Record<string, string> = { payslip: 'תלוש', invoice: 'חשבונית', freelancer: 'פרילנסר' }
const STATUS: Record<string, { label: string; tone: 'actual' | 'committed' | 'expected' | 'locked' }> = {
  draft: { label: 'טיוטה', tone: 'expected' },
  approved: { label: 'אושר', tone: 'committed' },
  sent_to_accountant: { label: 'נשלח לרו״ח', tone: 'committed' },
  paid: { label: 'שולם', tone: 'actual' },
}
const inputClass = 'h-8 w-24 rounded-[var(--radius-btn)] border border-border bg-surface px-2 text-sm tnum'

/** מסך 19 — §3.9. הקלט למעלה, החישוב עם ההסבר בפנים, והאישור נועל. */
export function PayrollView({ period, lines, terms, totals, history }: {
  period: string
  lines: PayrollLine[]
  terms: TermsRow[]
  totals: PayrollTotals
  history: { period: string; gross: number; employer_cost: number; employees: number }[]
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<PayrollLine | null>(null)
  const [paying, setPaying] = React.useState<PayrollLine | null>(null)

  const notify = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 8_000) }
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) { setError(r.error); return }
      setError(null); if (done) notify(done); router.refresh()
    })

  const saveInput = (line: PayrollLine, field: 'hours_worked' | 'meetings_count' | 'sales_count' | 'leads_count' | 'sales_amount_net', raw: string) => {
    const n = raw.trim() === '' ? null : Number(raw.replace(/[,\s₪]/g, ''))
    if (n !== null && !Number.isFinite(n)) { setError('ערך לא מספרי'); return }
    act(() => setPayrollInputs(line.employee.id, period, { [field]: n }))
  }

  const editable = (l: PayrollLine) => !l.month || l.month.status === 'draft'
  const prev = history.find((h) => h.period < period)
  const draftLines = lines.filter((l) => l.result && editable(l))

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title={`ברוטו ${formatMonth(period)}`} value={totals.gross} certainty="committed"
          subtitle={prev ? `חודש קודם ${formatMoney(Number(prev.gross))}` : `${totals.employees} עובדים`}
          drillTitle="ברוטו לעובד"
          drill={<ul className="divide-y divide-border text-sm">{lines.filter((l) => l.result).map((l) => <li key={l.employee.id} className="flex justify-between py-2"><span>{l.employee.name}</span><Money value={l.result!.grossTotal} /></li>)}</ul>} />
        <KpiCard title="עלות לחברה" value={totals.employerCost} nature="open"
          subtitle="כולל עלות מעביד לתלושים — זה מה שיוצא מהקופה"
          drillTitle="עלות לעובד"
          drill={<ul className="divide-y divide-border text-sm">{lines.filter((l) => l.result).map((l) => <li key={l.employee.id} className="flex justify-between py-2"><span>{l.employee.name} · {PAY_TYPE[l.employee.pay_type]}</span><Money value={l.result!.employerCostEst} /></li>)}</ul>} />
        <KpiCard title="מימון / נדל״ן" value={totals.byDivision.finance ?? 0} certainty="committed"
          subtitle={`נדל״ן ${formatMoney(totals.byDivision.realestate ?? 0)} — לפי מפתח החלוקה של כל עובד (§1.2)`}
          drillTitle="חלוקה לפעילויות"
          drill={<ul className="divide-y divide-border text-sm">{lines.filter((l) => l.result).map((l) => <li key={l.employee.id} className="flex justify-between py-2"><span>{l.employee.name}</span><span className="text-xs tnum">מימון {formatMoney(l.result!.divisionAllocation.finance ?? 0)} · נדל״ן {formatMoney(l.result!.divisionAllocation.realestate ?? 0)}</span></li>)}</ul>} />
        <KpiCard title="ממתין לאישור" value={totals.drafts} count nature={totals.drafts ? 'open' : undefined}
          subtitle={`${totals.approved} אושרו · ${totals.paid} שולמו`}
          drillTitle="בטיוטה" drill={<ul className="divide-y divide-border text-sm">{draftLines.map((l) => <li key={l.employee.id} className="flex justify-between py-2"><span>{l.employee.name}</span><span className="text-xs text-open">{l.missingInputs.length ? `חסר: ${l.missingInputs.join(', ')}` : 'מוכן לאישור'}</span></li>)}{!draftLines.length && <li className="py-2 text-text-3">אין</li>}</ul>} />
      </div>

      <Card className="flex flex-wrap items-center gap-2 text-sm">
        <Users size={16} className="text-text-2" />
        <span className="text-text-2">הדוח לרו״ח מופק מאותה פונקציה שמציגה את המסך (הנחיה 20)</span>
        <span className="ms-auto flex flex-wrap gap-2">
          <a href={`/reports/payroll/${period}`} target="_blank" rel="noreferrer">
            <Button type="button" variant="secondary"><FileText size={16} /> תצוגה מקדימה</Button>
          </a>
          <a href={`/reports/payroll/${period}?csv=1`}>
            <Button type="button" variant="secondary"><Download size={16} /> קובץ לאקסל</Button>
          </a>
          <Button variant="primary" disabled={pending || !draftLines.length}
            onClick={() => act(async () => {
              const r = await approvePayroll(period)
              if (r.ok) notify(`${r.approved} עובדים אושרו — התחשיב נשמר כתצלום`)
              return r
            })}>
            <Check size={16} /> אשר את כולם ({draftLines.length})
          </Button>
        </span>
      </Card>

      {msg && <p className="text-sm text-actual" role="status">{msg}</p>}
      {error && <p className="text-sm text-open" role="alert">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <ActionDrawerForm title="עובד חדש" action={addEmployee} submitLabel="הוסף"
          trigger={<Button variant="ghost" type="button"><Plus size={16} /> עובד</Button>}>
          <Field label="שם" required><Input name="name" required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ת.ז."><Input name="national_id" inputMode="numeric" /></Field>
            <Field label="סוג תשלום" required>
              <Select name="pay_type" defaultValue="payslip">
                <option value="payslip">תלוש</option><option value="invoice">חשבונית</option><option value="freelancer">פרילנסר</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="תחילת עבודה" required><Input name="start_date" type="date" required /></Field>
            <Field label="% מימון" required hint="השאר לנדל״ן. הדס = 80"><Input name="finance_pct" inputMode="decimal" defaultValue="100" required /></Field>
          </div>
        </ActionDrawerForm>

        <ActionDrawerForm title="הסכם עבודה" action={addEmploymentTerms} submitLabel="שמור הסכם"
          trigger={<Button variant="ghost" type="button"><Plus size={16} /> הסכם</Button>}>
          <Field label="עובד" required>
            <Select name="employee_id" required>{lines.map((l) => <option key={l.employee.id} value={l.employee.id}>{l.employee.name}</option>)}</Select>
          </Field>
          <Field label="בתוקף מ-" required hint="שינוי הסכם = שורה חדשה. הקודמת נסגרת יום לפני (§3.9).">
            <Input name="valid_from" type="date" required />
          </Field>
          <Field label="בסיס" required>
            <Select name="base_mode" defaultValue="monthly">
              <option value="monthly">חודשי</option><option value="hourly">שעתי</option><option value="none">ללא בסיס (עמלות בלבד)</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="בסיס חודשי"><Input name="monthly_base" inputMode="decimal" /></Field>
            <Field label="תעריף לשעה"><Input name="hourly_rate" inputMode="decimal" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="שעות צפויות"><Input name="expected_hours" inputMode="decimal" /></Field>
            <Field label="% עלות מעביד" hint="תלוש בלבד"><Input name="employer_cost_pct" inputMode="decimal" defaultValue="22" /></Field>
          </div>
          <Field label="רכיבי בונוס" hint='JSON. למשל: [{"name":"פגישות","type":"per_unit","rate":150,"unit":"meetings"}]'>
            <Textarea name="components" rows={4} dir="ltr" defaultValue="[]" />
          </Field>
          <Field label="הערות"><Input name="notes" /></Field>
        </ActionDrawerForm>
      </div>

      {/* טבלת ההזנה והתחשיב */}
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="text-xs text-text-2 bg-locked-bg">
            <tr>
              <th className="text-start p-2">עובד</th>
              <th className="text-end p-2">שעות</th>
              <th className="text-end p-2">פגישות</th>
              <th className="text-end p-2">מכירות</th>
              <th className="text-end p-2">סכום מכירות</th>
              <th className="text-end p-2">ברוטו</th>
              <th className="text-end p-2">עלות לחברה</th>
              <th className="text-start p-2">מצב</th>
              <th className="text-start p-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const st = STATUS[l.month?.status ?? 'draft']!
              return (
                <tr key={l.employee.id} className="border-t border-border align-middle">
                  <td className="p-2">
                    <span className="font-medium">{l.employee.name}</span>
                    <span className="text-xs text-text-3"> · {PAY_TYPE[l.employee.pay_type]}</span>
                    {l.proRata.length > 1 && <span className="block text-xs text-expected">שני הסכמים החודש — פרו-רטה</span>}
                    {l.missingTerms && <span className="block text-xs text-open">אין הסכם בתוקף לחודש הזה</span>}
                    {l.missingInputs.length > 0 && <span className="block text-xs text-open">חסר: {l.missingInputs.join(', ')}</span>}
                  </td>
                  {(['hours_worked', 'meetings_count', 'sales_count', 'sales_amount_net'] as const).map((f) => (
                    <td key={f} className="p-2 text-end">
                      <input className={inputClass} inputMode="decimal" disabled={!editable(l) || pending}
                        defaultValue={l.month?.[f] ?? ''} onBlur={(e) => saveInput(l, f, e.target.value)} />
                    </td>
                  ))}
                  <td className="p-2 text-end">{l.result ? <Money value={l.result.grossTotal} certainty={l.month?.status === 'paid' ? 'actual' : 'committed'} /> : <span className="text-text-3">—</span>}</td>
                  <td className="p-2 text-end">{l.result ? <Money value={l.result.employerCostEst} /> : <span className="text-text-3">—</span>}</td>
                  <td className="p-2"><StatusPill tone={st.tone}>{st.label}</StatusPill></td>
                  <td className="p-2">
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" disabled={!l.result} title="הצג את התחשיב" onClick={() => setDetail(l)}>
                        <FileText size={14} />
                      </Button>
                      {editable(l) && l.result && (
                        <Button size="sm" variant="secondary" disabled={pending} title="אשר את העובד הזה"
                          onClick={() => act(() => approvePayroll(period, l.employee.id), `${l.employee.name} אושר`)}><Check size={14} /></Button>
                      )}
                      {l.month?.status === 'approved' && (
                        <>
                          <Button size="sm" variant="secondary" disabled={pending} title="סמן ששולם" onClick={() => setPaying(l)}><Wallet size={14} /></Button>
                          <Button size="sm" variant="ghost" disabled={pending} title="החזר לטיוטה"
                            onClick={() => act(() => reopenPayroll(l.employee.id, period), 'הוחזר לטיוטה')}><RotateCcw size={14} /></Button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              )
            })}
            {!lines.length && <tr><td colSpan={9} className="p-4 text-center text-text-3">אין עובדים במערכת</td></tr>}
          </tbody>
        </table>
      </Card>

      {history.length > 1 && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold text-sm">עלות השכר לפי חודש</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {history.slice(0, 6).map((h) => {
              const max = Math.max(...history.map((x) => Number(x.employer_cost)), 1)
              return (
                <li key={h.period} className="flex items-center gap-2">
                  <span className="w-16 text-xs">{formatMonth(h.period)}</span>
                  <span className="flex-1 h-2 bg-locked-bg rounded"><span className="block h-2 bg-committed rounded" style={{ width: `${Math.round((Number(h.employer_cost) / max) * 100)}%` }} /></span>
                  <span className="w-28 text-xs text-text-2 tnum text-start">{formatMoney(Number(h.employer_cost))} · {h.employees}</span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {/* התחשיב עם ההסבר לכל שורה — §3.9 */}
      <DrillDrawer open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}
        title={detail ? `תחשיב ${detail.employee.name} — ${formatMonth(period)}` : ''}>
        {detail?.result && (
          <div className="flex flex-col gap-3 text-sm">
            {detail.proRata.length > 1 && (
              <p className="text-xs text-expected">
                ההסכם השתנה באמצע החודש — החישוב פרו-רטה לפי ימים: {detail.proRata.map((p) => `${p.days} ימים (${Math.round(p.factor * 100)}%)`).join(' + ')}
              </p>
            )}
            <ul className="divide-y divide-border">
              <li className="flex justify-between gap-2 py-2">
                <span><span className="font-medium">בסיס</span><span className="block text-xs text-text-3">{detail.result.baseExplanation}</span></span>
                <Money value={detail.result.base} />
              </li>
              {detail.result.components.map((c, i) => (
                <li key={`${c.name}:${i}`} className="flex justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    {c.capped && <StatusPill tone="expected" className="ms-2">תקרה</StatusPill>}
                    <span className="block text-xs text-text-3">{c.explanation}</span>
                  </span>
                  <Money value={c.amount} />
                </li>
              ))}
              {detail.result.adjustmentLines.map((a, i) => (
                <li key={`${a.label}:${i}`} className="flex justify-between gap-2 py-2">
                  <span><span className="font-medium">התאמה</span><span className="block text-xs text-text-3">{a.label}{a.note ? ` — ${a.note}` : ''}</span></span>
                  <Money value={a.amount} />
                </li>
              ))}
              <li className="flex justify-between gap-2 py-2 font-medium border-t border-border">
                <span>ברוטו</span><Money value={detail.result.grossTotal} />
              </li>
              <li className="flex justify-between gap-2 py-2">
                <span>{detail.employee.pay_type === 'payslip' ? 'עלות מעביד' : 'עלות לחברה'}</span>
                <Money value={detail.result.employerCostEst} />
              </li>
              <li className="flex justify-between gap-2 py-2 text-xs text-text-2">
                <span>חלוקה לפעילויות</span>
                <span>מימון {formatMoney(detail.result.divisionAllocation.finance ?? 0)} · נדל״ן {formatMoney(detail.result.divisionAllocation.realestate ?? 0)}</span>
              </li>
            </ul>

            {editable(detail) ? (
              <ActionDrawerForm title="התאמה ידנית" action={addPayrollAdjustment} submitLabel="הוסף התאמה"
                trigger={<Button variant="secondary" type="button"><Plus size={16} /> התאמה ידנית</Button>}>
                <input type="hidden" name="employee_id" value={detail.employee.id} />
                <input type="hidden" name="period" value={period} />
                <Field label="על מה" required hint="מופיע בדוח לרו״ח ובמה שהעובד רואה"><Input name="label" required /></Field>
                <Field label="סכום" required hint="שלילי = ניכוי"><Input name="amount" inputMode="decimal" required /></Field>
                <Field label="הערה"><Input name="note" /></Field>
              </ActionDrawerForm>
            ) : (
              <p className="text-xs text-text-3">
                החודש אושר{detail.month?.approved_by_name ? ` ע"י ${detail.month.approved_by_name}` : ''} — תיקון נעשה כהתאמה ידנית בחודש הבא, עם הפניה (§3.9).
              </p>
            )}
          </div>
        )}
      </DrillDrawer>

      <DrillDrawer open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)}
        title={paying ? `תשלום — ${paying.employee.name}` : ''}>
        {paying && (
          <form className="flex flex-col gap-3"
            action={(fd) => {
              const date = String(fd.get('date') ?? '')
              act(async () => {
                const r = await markPayrollPaid(paying.employee.id, period, date)
                if (r.ok) { setPaying(null); notify('נרשמה תנועת שכר בחשבון') }
                return r
              })
            }}>
            <p className="text-sm text-text-2">
              תירשם תנועת הוצאה על {formatMoney(paying.employee.pay_type === 'payslip' ? paying.result!.employerCostEst : paying.result!.grossTotal)}
              {paying.employee.pay_type === 'payslip' ? ' (עלות מעביד)' : ' (סכום החשבונית)'} ותקושר לחודש הזה.
            </p>
            <Field label="תאריך התשלום" required><Input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Button type="submit" variant="primary" disabled={pending}>סמן ששולם</Button>
          </form>
        )}
      </DrillDrawer>

      <p className="text-xs text-text-3">
        {terms.length} הסכמי עבודה במערכת · עלות המעביד היא הערכה לפי האחוז שבהסכם; המספר המחייב הוא התלוש בפועל.
      </p>
    </div>
  )
}
