import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  CircleDashed,
  HelpCircle,
  Lock,
  MessageCircleQuestion,
  Minus,
  X,
} from 'lucide-react'
import { cn } from '@/lib/ui/cn'

export type PillTone = 'actual' | 'committed' | 'expected' | 'open' | 'locked' | 'neutral'

const tones: Record<PillTone, string> = {
  actual: 'bg-actual-bg text-actual',
  committed: 'bg-committed-bg text-committed',
  expected: 'bg-expected-bg text-expected',
  open: 'bg-open-bg text-open',
  locked: 'bg-locked-bg text-locked',
  neutral: 'bg-locked-bg text-text-2',
}

/**
 * <StatusPill> — UIUX §4.2.
 * "מלאה בצבע רקע בהיר + טקסט בצבע כהה של אותה משפחה. תמיד עם אייקון קטן."
 */
export function StatusPill({
  tone,
  icon: Icon = Circle,
  children,
  onClick,
  className,
}: {
  tone: PillTone
  icon?: LucideIcon
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        onClick && 'cursor-pointer hover:opacity-80',
        className,
      )}
    >
      <Icon size={12} />
      {children}
    </Tag>
  )
}

// ── מיפויים מוכנים לרשימות הסגורות (UIUX §4.2 טבלה) ────────────────────────

export function CertaintyPill({ certainty }: { certainty: 'actual' | 'committed' | 'expected' }) {
  const map = {
    actual: { tone: 'actual' as const, label: 'בפועל' },
    committed: { tone: 'committed' as const, label: 'ודאי' },
    expected: { tone: 'expected' as const, label: 'פוטנציאל' },
  }[certainty]
  return <StatusPill tone={map.tone}>{map.label}</StatusPill>
}

export function CollectionPill({ status, daysOverdue }: { status: string; daysOverdue?: number }) {
  const map: Record<string, { tone: PillTone; label: string; icon: LucideIcon }> = {
    fully_paid: { tone: 'actual', label: 'שולם', icon: CheckCircle2 },
    partially_paid: { tone: 'committed', label: 'שולם חלקית', icon: CircleDashed },
    advance_paid: { tone: 'committed', label: 'שולם מקדמה', icon: CircleDashed },
    not_collected: { tone: 'open', label: 'לא נגבה', icon: Circle },
    legal_collection: { tone: 'open', label: 'משפטי', icon: AlertCircle },
    cancelled: { tone: 'locked', label: 'מבוטל', icon: X },
  }
  const m = map[status] ?? { tone: 'neutral' as const, label: status, icon: Circle }
  const label = daysOverdue && daysOverdue > 0 && m.tone === 'open' ? `באיחור ${daysOverdue} יום` : m.label
  return <StatusPill tone={m.tone} icon={m.icon}>{label}</StatusPill>
}

export function InvoicePill({ status, onClick }: { status: string; onClick?: () => void }) {
  const map: Record<string, { tone: PillTone; label: string; icon: LucideIcon }> = {
    has_invoice: { tone: 'actual', label: 'יש חשבונית', icon: Check },
    missing: { tone: 'open', label: 'חסרה', icon: X },
    no_invoice_needed: { tone: 'locked', label: 'לא נדרשת', icon: Minus },
    unknown: { tone: 'expected', label: 'לא ידוע', icon: HelpCircle },
  }
  const m = map[status] ?? { tone: 'neutral' as const, label: status, icon: Circle }
  return <StatusPill tone={m.tone} icon={m.icon} onClick={onClick}>{m.label}</StatusPill>
}

export function PeriodPill({ locked, period }: { locked: boolean; period: string }) {
  return locked ? (
    <StatusPill tone="locked" icon={Lock}>נעול {period}</StatusPill>
  ) : (
    <StatusPill tone="committed" icon={Circle}>פתוח</StatusPill>
  )
}

export function ReviewPill({ status }: { status: string }) {
  const map: Record<string, { tone: PillTone; label: string; icon: LucideIcon }> = {
    ok: { tone: 'actual', label: 'תקין', icon: Check },
    ask_nissim: { tone: 'expected', label: 'לשאול את ניסים', icon: MessageCircleQuestion },
    ask_aviv: { tone: 'expected', label: 'לשאול את אביב', icon: MessageCircleQuestion },
    ask_yoni: { tone: 'expected', label: 'לשאול את יוני', icon: MessageCircleQuestion },
    unknown_expense: { tone: 'open', label: 'לא מזוהה', icon: HelpCircle },
  }
  const m = map[status] ?? { tone: 'neutral' as const, label: status, icon: Circle }
  return <StatusPill tone={m.tone} icon={m.icon}>{m.label}</StatusPill>
}

export function DivisionPill({ division }: { division: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    realestate: { label: 'נדל"ן', cls: 'text-div-realestate' },
    finance: { label: 'מימון', cls: 'text-div-finance' },
    shared: { label: 'משותף', cls: 'text-div-shared' },
    private: { label: 'פרטי', cls: 'text-div-private' },
  }
  const m = map[division] ?? { label: division, cls: 'text-text-2' }
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', m.cls)}>
      <span className="inline-block w-2 h-2 rounded-full bg-current" />
      {m.label}
    </span>
  )
}
