'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, BellOff, Check, Info, Play, ShieldAlert } from 'lucide-react'
import { alertAction, runAlertsNow, setDeliveryTargets } from '@/app/actions/cashflow'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import { Money } from '@/components/money'
import { StatusPill } from '@/components/status-pill'
import type { AlertRow } from '@/lib/queries/dashboard'
import { formatDate } from '@/lib/ui/format'
import { cn } from '@/lib/ui/cn'

const SEVERITY: Record<string, { label: string; tone: 'open' | 'expected' | 'committed'; icon: typeof AlertTriangle }> = {
  critical: { label: 'קריטי', tone: 'open', icon: ShieldAlert },
  high: { label: 'גבוה', tone: 'expected', icon: AlertTriangle },
  info: { label: 'מידע', tone: 'committed', icon: Info },
}
const CHANNEL: Record<string, string> = { whatsapp: 'וואטסאפ', email: 'מייל', screen: 'במסך', daily_summary: 'סיכום יומי', weekly_report: 'דוח שבועי' }

/** ADDENDUM ב.11 — רשימת ההתראות: snooze, סגירה, הרצה ידנית, יעדי מסירה (הנחיה 16). */
export function AlertsList({ alerts, targets, lastRun, today }: {
  alerts: AlertRow[]
  targets: { whatsapp: string | null; email: string | null }
  lastRun: { at: string | null; status: string | null; error: string | null } | null
  today: string
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [msg, setMsg] = React.useState<string | null>(null)
  const [showResolved, setShowResolved] = React.useState(false)
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) =>
    start(async () => { const r = await fn(); setMsg(r.ok ? (done ?? null) : r.error); router.refresh() })

  const active = alerts.filter((a) => !a.resolved_at)
  const resolved = alerts.filter((a) => a.resolved_at)
  const shown = showResolved ? alerts : active

  return (
    <div className={cn('flex flex-col gap-5', pending && 'opacity-80')}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={pending} onClick={() => run(async () => { const r = await runAlertsNow(); return r.ok ? { ok: true } : r }, 'ההערכה רצה')}>
          <Play size={16} /> הרץ הערכה עכשיו
        </Button>
        <span className="text-xs text-text-3">
          {lastRun?.at ? `ריצה אחרונה: ${lastRun.at.slice(0, 16).replace('T', ' ')} · ${lastRun.status === 'succeeded' ? 'הצליחה' : lastRun.status === 'failed' ? `נכשלה: ${lastRun.error}` : lastRun.status}` : 'עדיין לא רצה. חלק ג׳: 06:45 יומי + אחרי כל ייבוא.'}
        </span>
        <label className="ms-auto inline-flex items-center gap-1 text-sm text-text-2"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> הצג סגורות ({resolved.length})</label>
      </div>
      {msg && <p className="text-sm text-text-2" role="status">{msg}</p>}

      {!shown.length && <Card className="text-sm text-text-2">אין התראות פעילות. ההתראה הראשונה שתיתפס תופיע כאן ותישלח לפי הערוץ שלה.</Card>}
      <ul className="flex flex-col gap-2">
        {shown.map((a) => {
          const sev = SEVERITY[a.severity] ?? SEVERITY.info!
          const snoozed = a.snoozed_until && a.snoozed_until > today
          return (
            <li key={a.id}>
              <Card className={cn('flex flex-col gap-2', a.resolved_at && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={a.resolved_at ? 'locked' : sev.tone} icon={a.resolved_at ? Check : sev.icon}>{a.resolved_at ? 'נסגרה' : sev.label}</StatusPill>
                  <span className="font-medium">{a.title}</span>
                  {a.amount != null && <Money value={a.amount} nature={a.severity === 'critical' ? 'open' : undefined} />}
                  <span className="text-xs text-text-3 ms-auto">{formatDate(a.created_at.slice(0, 10))} · {a.channels.map((c) => CHANNEL[c] ?? c).join(' · ')}</span>
                </div>
                {a.detail && <p className="text-sm text-text-2">{a.detail}</p>}
                {snoozed && <p className="text-xs text-text-3 inline-flex items-center gap-1"><BellOff size={12} /> מושהית עד {formatDate(a.snoozed_until!)}</p>}
                {!a.resolved_at && (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={pending} onClick={() => run(() => alertAction(a.id, 'snooze', { days: 3 }), 'הושהתה ל-3 ימים')}><BellOff size={14} /> השהה 3 ימים</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => alertAction(a.id, 'resolve'), 'נסגרה')}><Check size={14} /> טופל</Button>
                  </div>
                )}
              </Card>
            </li>
          )
        })}
      </ul>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">יעדי מסירה</h2>
        <p className="text-xs text-text-3">הנחיה 16: כל וואטסאפ ומייל עוברים דרך outbox. וואטסאפ נשלח ב-Green-API (מפתחות בסביבת השרת). מייל — עם שכבת Google (ב.1), אחרי שלב 5.</p>
        <form action={(fd) => run(() => setDeliveryTargets(fd), 'היעדים נשמרו')} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <Field label="וואטסאפ של דן" hint="בינלאומי בלי +, למשל 972501234567"><Input name="notify_whatsapp_dan" defaultValue={targets.whatsapp ?? ''} dir="ltr" inputMode="tel" /></Field>
          <Field label="מייל של דן"><Input name="notify_email_dan" type="email" defaultValue={targets.email ?? ''} dir="ltr" /></Field>
          <Button type="submit" disabled={pending}>שמור יעדים</Button>
        </form>
      </Card>
    </div>
  )
}
