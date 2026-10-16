'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { NAV } from './nav-items'
import { cn } from '@/lib/ui/cn'

/**
 * תפריט ימני — UIUX §3.1.
 * "240px, מתכווץ ל-64px (אייקונים בלבד) בלחיצה; זוכר מצב."
 */
export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('harel.sidebar')
      // UIUX §3.2 — טאבלט (768–1024): תפריט מכווץ כברירת מחדל, אלא אם המשתמש בחר אחרת.
      setCollapsed(stored === null ? window.innerWidth < 1024 : stored === '1')
    } catch { /* ignore */ }
  }, [])

  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem('harel.sidebar', c ? '0' : '1') } catch { /* ignore */ }
      return !c
    })
  }

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col bg-surface border-s border-border h-dvh sticky top-0 shrink-0 transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className="h-14 flex items-center justify-between px-3 border-b border-border">
        {!collapsed && (
          <Link href="/" className="font-bold text-brand text-lg">הר-אל</Link>
        )}
        <button type="button" onClick={toggle} className="p-2 rounded text-text-2 hover:bg-locked-bg" aria-label="כווץ תפריט">
          {collapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((item, i) =>
          item === 'divider' ? (
            <div key={i} className="my-2 border-t border-border mx-3" />
          ) : !item.built ? (
            // מסך שטרם נבנה: לא קישור, כדי לא להוביל ל-404 ולא לבצע prefetch.
            <span key={item.href} title={collapsed ? item.label : undefined} aria-disabled
              className="flex items-center gap-3 px-4 h-10 text-sm text-text-3 opacity-60 cursor-default">
              <item.icon size={20} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && <span className="ms-auto text-[10px]">בקרוב</span>}
            </span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 px-4 h-10 text-sm transition-colors',
                pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
                  ? 'bg-locked-bg text-text font-medium border-e-2 border-brand'
                  : 'text-text-2 hover:bg-locked-bg hover:text-text',
              )}
            >
              <item.icon size={20} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          ),
        )}
      </nav>
    </aside>
  )
}
