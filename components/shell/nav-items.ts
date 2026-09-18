import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  Coins,
  FileUp,
  FileWarning,
  Link2,
  Lock,
  Percent,
  Receipt,
  Settings,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  locked?: boolean
  /** SPEC §5 מספר המסך. */
  screen: number
  /** נבנה כבר? לא-בנוי מוצג מעומעם. */
  built: boolean
}

/** UIUX §3.1 — סדר התפריט הימני. */
export const NAV: (NavItem | 'divider')[] = [
  { href: '/', label: 'מצב החברה', icon: Building2, screen: 21, built: true },
  { href: '/deals', label: 'תיקים', icon: Briefcase, screen: 4, built: true },
  { href: '/transactions', label: 'תנועות', icon: Receipt, screen: 5, built: true },
  { href: '/pnl', label: 'רווח והפסד', icon: BarChart3, screen: 2, built: true },
  { href: '/cashflow', label: 'תזרים', icon: TrendingUp, screen: 3, built: true },
  { href: '/collections', label: 'גביה', icon: Coins, screen: 20, built: true },
  'divider',
  { href: '/nissim', label: 'ניסים', icon: Lock, locked: true, screen: 7, built: true },
  { href: '/partners', label: 'שותפים', icon: Lock, locked: true, screen: 8, built: true },
  { href: '/private', label: 'פרייבט', icon: Lock, locked: true, screen: 9, built: true },
  'divider',
  { href: '/fixed-expenses', label: 'הוצאות קבועות', icon: CalendarClock, screen: 6, built: true },
  { href: '/import', label: 'ייבוא', icon: FileUp, screen: 11, built: true },
  { href: '/vat', label: 'מע"מ', icon: Percent, screen: 10, built: true },
  { href: '/gaps', label: 'פערי חשבוניות', icon: FileWarning, screen: 12, built: true },
  { href: '/payroll', label: 'שכר', icon: Users, screen: 19, built: false },
  { href: '/leads', label: 'לידים', icon: BarChart3, screen: 14, built: true },
  { href: '/forecast', label: 'תחזית', icon: TrendingUp, screen: 13, built: true },
  { href: '/tasks', label: 'משימות', icon: CheckSquare, screen: 15, built: false },
  { href: '/links', label: 'קישורים', icon: Link2, screen: 17, built: false },
  { href: '/settings', label: 'הגדרות', icon: Settings, screen: 18, built: true },
]

/** UIUX §3.2 — ניווט תחתון בנייד: מצב · תיקים · ➕ · משימות · עוד. */
export const MOBILE_NAV = {
  left: [
    { href: '/', label: 'מצב', icon: Building2 },
    { href: '/deals', label: 'תיקים', icon: Briefcase },
  ],
  right: [
    { href: '/tasks', label: 'משימות', icon: ClipboardList },
    { href: '/more', label: 'עוד', icon: Wallet },
  ],
}
