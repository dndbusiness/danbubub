import Link from 'next/link'
import { Check, ClipboardCheck, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/status-pill'
import { monthCloseStatusFor } from '@/lib/queries/month-close'
import { formatMonth } from '@/lib/ui/format'

const LINK: Record<string, string> = {
  bank_and_card_imported: '/import',
  no_unknown_transactions: '/transactions',
  missing_invoices_handled: '/transactions',
  nissim_card_closed: '/nissim',
  no_stale_open_expenses: '/import/inbox',
}

/**
 * צ'קליסט "סגירת חודש לרו"ח" — ADDENDUM ב.7.
 * כל ✓ אוטומטי מהנתונים; אין כאן סימון ידני. מוצג גם באירוע היומן של ב.2.
 */
export async function MonthCloseChecklist({ month }: { month: string }) {
  const s = await monthCloseStatusFor(month)
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck size={18} className="text-text-2" />
        <h2 className="font-semibold">סגירת {formatMonth(month)} לרו״ח</h2>
        <StatusPill tone={s.ready ? 'actual' : 'expected'}>{s.done}/{s.total}</StatusPill>
        {s.ready ? <span className="text-xs text-actual">מוכן לשליחה</span> : <span className="text-xs text-open">{s.blockers.length} חסמים</span>}
        <span className="text-xs text-text-3 ms-auto">כל ✓ אוטומטי מהנתונים (ADDENDUM ב.7)</span>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {s.items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center gap-2">
            {i.done ? <Check size={15} className="text-actual shrink-0" /> : <X size={15} className={i.blocking ? 'text-open shrink-0' : 'text-expected shrink-0'} />}
            <span className={i.done ? 'text-text-2' : 'font-medium'}>{i.label}</span>
            {!i.done && i.blocking && <StatusPill tone="open">חוסם</StatusPill>}
            <span className="text-xs text-text-3">{i.detail}</span>
            {!i.done && LINK[i.key] && <Link href={LINK[i.key]!} className="text-xs underline">לטיפול</Link>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-text-3">
        הדוח הסופי מופק ב-12 לחודש רק אם כל החסמים סגורים; אחרת נוצרת משימה. חומר הסגירה נשלח לרו״ח באותו יום.
      </p>
    </Card>
  )
}
