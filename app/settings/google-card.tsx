'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Link2, Unplug, X, Play } from 'lucide-react'
import { disconnectGoogleAction, runDailySummaryNow } from '@/app/actions/settings'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/status-pill'
import type { GoogleIntegration } from '@/lib/google/store'

const SERVICES: { key: string; label: string; scopes: string[] }[] = [
  { key: 'gmail', label: 'Gmail — קליטת חשבוניות, שליחת סיכומים', scopes: ['gmail.readonly', 'gmail.send', 'gmail.modify'] },
  { key: 'calendar', label: 'יומן — תזכורות ואירועי סגירה', scopes: ['calendar.events'] },
  { key: 'drive', label: 'דרייב — דוחות וגיבויים (רק קבצי המערכת)', scopes: ['drive.file'] },
  { key: 'sheets', label: 'Sheets — ייצוא/ייבוא גיליונות', scopes: ['spreadsheets'] },
]

/** ADDENDUM ב.1 — כרטיס החיבור לגוגל: מצב, scopes שאושרו, חיבור/ניתוק. */
export function GoogleCard({ integ, env, notice }: { integ: GoogleIntegration | null; env: { client: boolean; secretsKey: boolean }; notice: { kind: string; text: string } | null }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [msg, setMsg] = React.useState<string | null>(null)
  const [chosen, setChosen] = React.useState<string[]>(SERVICES.map((s) => s.key))
  const connected = integ?.status === 'connected'
  const has = (short: string) => integ?.scopes.some((s) => s.endsWith(`/auth/${short}`))
  const ready = env.client && env.secretsKey

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 size={18} className="text-text-2" />
        <h2 className="font-semibold">Google Workspace</h2>
        {integ ? (
          connected ? <StatusPill tone="actual" icon={Check}>מחובר · {integ.connected_email ?? integ.account_label}</StatusPill>
            : <StatusPill tone="open" icon={X}>{integ.status === 'expired' ? 'ההרשאה פגה — לחבר מחדש' : `שגיאה: ${integ.last_error ?? integ.status}`}</StatusPill>
        ) : <StatusPill tone="neutral">לא מחובר</StatusPill>}
        {integ?.last_ok_at && <span className="text-xs text-text-3">אומת לאחרונה {integ.last_ok_at.slice(0, 16).replace('T', ' ')}</span>}
      </div>
      {notice && <p className={notice.kind === 'error' ? 'text-sm text-open' : 'text-sm text-actual'} role="status">{notice.text}</p>}
      {!ready && (
        <p className="text-sm text-open">
          חסר בסביבת השרת: {[!env.client && 'GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (OAuth client מ-Google Cloud Console, redirect: /api/google/callback)', !env.secretsKey && 'SECRETS_KEY (הצפנת refresh token — הנחיה 15)'].filter(Boolean).join(' · ')}
        </p>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {SERVICES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <input type="checkbox" checked={chosen.includes(s.key)} disabled={connected} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.key] : chosen.filter((k) => k !== s.key))} />
            <span>{s.label}</span>
            <span className="text-xs text-text-3 font-mono" dir="ltr">{s.scopes.join(' ')}</span>
            {connected && (s.scopes.every(has) ? <Check size={14} className="text-actual" /> : <span className="text-xs text-open">לא אושר</span>)}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {!connected && <a href={`/api/google/connect?services=${chosen.join(',')}`} className={ready && chosen.length ? '' : 'pointer-events-none opacity-50'}><Button variant="primary"><Link2 size={16} /> חבר את גוגל</Button></a>}
        {connected && <a href={`/api/google/connect?services=${SERVICES.map((s) => s.key).join(',')}&hint=${encodeURIComponent(integ!.account_label)}`}><Button><Link2 size={16} /> חבר מחדש / הוסף הרשאות</Button></a>}
        {integ && <Button variant="ghost" disabled={pending} onClick={() => { if (confirm('לנתק את גוגל? הסוד נמחק והג\'ובים שתלויים בו יעצרו.')) start(async () => { await disconnectGoogleAction(); router.refresh() }) }}><Unplug size={16} /> נתק</Button>}
        <Button variant="secondary" disabled={pending} className="ms-auto" onClick={() => start(async () => { const r = await runDailySummaryNow(); setMsg(r.ok ? `סיכום יומי הופק${r.pdf ? ' · PDF' : ''}${r.driveUrl ? ' · דרייב' : ''}${r.emailed ? ' · נשלח במייל' : ' · המייל ממתין (אין Gmail מחובר / יעד)'}` : r.error); router.refresh() })}>
          <Play size={16} /> הפק סיכום יומי עכשיו
        </Button>
      </div>
      {msg && <p className="text-sm text-text-2" role="status">{msg}</p>}
      <p className="text-xs text-text-3">OAuth של המשתמש, scopes מינימליים, refresh token מוצפן (SECRETS_KEY) — ב-Supabase: Vault. הנחיה 15: אין סיסמאות במערכת.</p>
    </Card>
  )
}
