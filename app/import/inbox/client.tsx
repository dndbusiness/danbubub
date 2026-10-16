'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Check, FileText, Mail, Pencil, X } from 'lucide-react'
import { ignoreIntake, uploadIntake, verifyIntake } from '@/app/actions/intake'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DrillDrawer } from '@/components/drill-drawer'
import { Field, Input, Select } from '@/components/ui/field'
import { Money } from '@/components/money'
import { StatusPill } from '@/components/status-pill'
import type { CandidateRow, TxOption } from '@/lib/queries/intake'
import type { MatchCandidate } from '@/lib/match/invoices'
import { formatDate, formatMoney } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

const SOURCE: Record<string, string> = { gmail: 'מייל', drive: 'דרייב', manual_upload: 'העלאה' }
const METHOD: Record<string, string> = { template: 'תבנית ספק', rules: 'כללים', llm: 'הצעת LLM', manual: 'ידני' }

/**
 * ב.3 — תור הקליטה. UIUX §6 "אישור חשבונית ממייל: התראה → כרטיס עם השדות המחולצים → 'נכון' / ✎".
 * הנחיה 17: כל מה שמוצג הוא הצעה; "נכון ✓" הוא האישור האנושי.
 */
export function InboxQueue({ candidates, suppliers, matches }: {
  candidates: CandidateRow[]
  suppliers: { id: string; name: string }[]
  matches: Record<string, { options: TxOption[]; suggested: MatchCandidate[] }>
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [open, setOpen] = React.useState<CandidateRow | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const notify = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 8_000) }

  function verify(c: CandidateRow, fd: FormData) {
    setError(null)
    start(async () => {
      const r = await verifyIntake(c.id, fd)
      if (!r.ok) { setError(r.error); return }
      setOpen(null)
      notify(`נרשמה חשבונית${r.matchedTxId ? ' ושודכה לתנועה ✓' : ' — ללא תנועה (נכנסת לתזרים)'}${r.forwarded ? ' · הועברה לחשבונית ירוקה' : ''}`)
      router.refresh()
    })
  }
  const ignore = (c: CandidateRow) => start(async () => { await ignoreIntake(c.id, 'התעלמנו'); setOpen(null); router.refresh() })
  const upload = (fd: FormData) => start(async () => { const r = await uploadIntake(fd); if (!r.ok) { setError(r.error); return } notify(r.status === 'duplicate' ? 'הקובץ כבר נקלט' : r.kind === 'statement' ? 'זוהה דף פירוט — נמצא בתור' : 'נקלט — בדקו את ההצעה'); router.refresh() })

  const pendingList = candidates.filter((c) => c.status === 'pending')
  const done = candidates.filter((c) => c.status !== 'pending')

  return (
    <div className={cn('flex flex-col gap-4', pending && 'opacity-80')}>
      <Card className="flex flex-col gap-2">
        <form action={upload} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm text-text-2">
            צילום / קובץ חשבונית
            <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx" capture="environment" required className="text-sm" />
          </label>
          <Field label="הערה"><Input name="note" placeholder="למשל: חשבונית עו״ד לתיק כהן" /></Field>
          <Button type="submit" variant="primary" disabled={pending}><Camera size={16} /> קלוט</Button>
          <span className="text-xs text-text-3">אותו צינור כמו Gmail ו-Drive: חילוץ → הצעה → אישור שלכם.</span>
        </form>
      </Card>
      {msg && <p className="text-sm text-actual" role="status">{msg}</p>}
      {error && !open && <p className="text-sm text-open" role="alert">{error}</p>}

      {!pendingList.length && <Card className="text-sm text-text-2">אין מסמכים שממתינים לאישור.</Card>}
      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {pendingList.map((c) => {
          const e = c.extracted
          return (
            <li key={c.id}>
              <Card className={cn('flex flex-col gap-2 border-s-4', c.kind === 'statement' ? 'border-s-committed' : (e?.confidence ?? 0) >= 0.8 ? 'border-s-actual' : 'border-s-expected')}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {c.source === 'gmail' ? <Mail size={16} className="text-text-3" /> : <FileText size={16} className="text-text-3" />}
                  <span className="font-medium truncate max-w-[220px]" dir="auto">{e?.supplierName ?? c.sender ?? c.file_name}</span>
                  {c.kind === 'statement' ? <StatusPill tone="committed">דף פירוט → ייבוא</StatusPill> : e?.method ? <StatusPill tone={e.confidence >= 0.8 ? 'actual' : 'expected'}>{METHOD[e.method] ?? e.method} · {Math.round(e.confidence * 100)}%</StatusPill> : null}
                  <span className="text-xs text-text-3 ms-auto">{SOURCE[c.source] ?? c.source} · {formatDate(c.received_at.slice(0, 10))}</span>
                </div>
                {c.kind !== 'statement' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>סה"כ {e?.gross !== undefined ? <Money value={e.gross} certainty="expected" /> : <span className="text-open">?</span>}</span>
                    <span className="text-text-2">מע"מ {e?.vat !== undefined ? formatMoney(e.vat) : '?'}</span>
                    <span className="text-text-2">תאריך {e?.date ? formatDate(e.date) : '?'}</span>
                    <span className="text-text-2">מס׳ {e?.docNumber ?? '?'}</span>
                  </div>
                )}
                {e?.warnings?.length ? <p className="text-xs text-expected">{e.warnings.join(' · ')}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {c.kind === 'statement' ? (
                    <a href="/import"><Button size="sm" variant="primary">לתור הייבוא</Button></a>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => setOpen(c)}><Check size={14} /> נכון / ✎ עריכה</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => ignore(c)}><X size={14} /> התעלם</Button>
                  {c.local_path && <a href={`/api/intake/file/${c.id}`} target="_blank" className="text-xs underline self-center">פתח קובץ</a>}
                </div>
              </Card>
            </li>
          )
        })}
      </ul>

      {done.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer text-text-2">טופלו ({done.length})</summary>
          <ul className="divide-y divide-border mt-2">{done.map((c) => <li key={c.id} className="flex justify-between py-1"><span className="truncate">{c.extracted?.supplierName ?? c.file_name}</span><span className="text-text-3 text-xs">{c.status === 'matched' ? (c.matched_tx_id ? 'אושר ושודך' : 'אושר') : c.status === 'ignored' ? 'התעלמנו' : c.status}</span></li>)}</ul>
        </details>
      )}

      <DrillDrawer open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)} title={open ? `אישור: ${open.extracted?.supplierName ?? open.file_name ?? ''}` : ''}>
        {open && <VerifyForm c={open} suppliers={suppliers} match={matches[open.id] ?? { options: [], suggested: [] }} onSubmit={(fd) => verify(open, fd)} error={error} pending={pending} />}
      </DrillDrawer>
    </div>
  )
}

function VerifyForm({ c, suppliers, match, onSubmit, error, pending }: { c: CandidateRow; suppliers: { id: string; name: string }[]; match: { options: TxOption[]; suggested: MatchCandidate[] }; onSubmit: (fd: FormData) => void; error: string | null; pending: boolean }) {
  const e = c.extracted
  const [gross, setGross] = React.useState(e?.gross?.toString() ?? '')
  const [vat, setVat] = React.useState(e?.vat?.toString() ?? '')
  const g = Number(gross) || 0, v = Number(vat) || 0
  const best = match.suggested[0]
  return (
    <form action={onSubmit} className="flex flex-col gap-3">
      <p className="text-xs text-text-3 inline-flex items-center gap-1"><Pencil size={12} /> השדות הם הצעה ({METHOD[e?.method ?? 'rules']}). תקנו ואשרו — רק אז זה נחשב מאומת.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ספק קיים"><Select name="supplier_id" defaultValue={e?.supplierId ?? ''}><option value="">— חדש / לפי שם —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="שם ספק (אם חדש)"><Input name="supplier_name" defaultValue={e?.supplierName ?? ''} dir="auto" /></Field>
        <Field label="מס׳ מסמך"><Input name="doc_number" defaultValue={e?.docNumber ?? ''} dir="ltr" /></Field>
        <Field label="תאריך" required><Input name="date" type="date" required defaultValue={e?.date ?? ''} /></Field>
        <Field label='סה"כ כולל מע"מ' required><Input name="gross" inputMode="decimal" dir="ltr" required value={gross} onChange={(ev) => setGross(ev.target.value)} /></Field>
        <Field label='מע"מ' hint={`נטו: ${formatMoney(Math.round((g - v) * 100) / 100)}`}><Input name="vat" inputMode="decimal" dir="ltr" value={vat} onChange={(ev) => setVat(ev.target.value)} /></Field>
        <input type="hidden" name="net" value={g && (vat !== '') ? String(Math.round((g - v) * 100) / 100) : ''} />
        <Field label="תאריך יעד לתשלום" hint="אם טרם שולם — נכנס לתזרים"><Input name="due_date" type="date" /></Field>
      </div>
      <Field label="שידוך לתנועה" hint={best ? `הצעה: ${formatDate(best.tx.dateCash)} · ${best.tx.counterparty ?? best.tx.description ?? ''} · ${best.reasons.join(', ')}` : 'אין תנועה תואמת — תישמר כ"חשבונית ללא תנועה"'}>
        <Select name="tx_id" defaultValue={best && best.score >= 0.7 ? best.tx.id : ''}>
          <option value="">— אוטומטי / ללא —</option>
          {match.options.map((o) => <option key={o.id} value={o.id} disabled={Boolean(o.invoice_id)}>{formatDate(o.date_cash)} · {o.counterparty ?? o.description ?? '—'} · {formatMoney(o.amount_gross)}{o.invoice_id ? ' (משודכת)' : ''}</option>)}
        </Select>
      </Field>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="learn" value="on" defaultChecked /> ללמוד תבנית לספק מהמסמך הזה (ב.3)</label>
      {c.doc_text && <details className="text-xs text-text-2"><summary className="cursor-pointer">טקסט המסמך</summary><pre className="whitespace-pre-wrap max-h-48 overflow-auto" dir="auto">{c.doc_text}</pre></details>}
      {error && <p className="text-sm text-open" role="alert">{error}</p>}
      <div className="flex gap-2"><Button type="submit" variant="primary" disabled={pending}><Check size={16} /> נכון — אשר</Button></div>
    </form>
  )
}
