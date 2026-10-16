'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { MOBILE_NAV } from './nav-items'
import { cn } from '@/lib/ui/cn'

/** UIUX §3.2 — ניווט תחתון 5 פריטים בנייד. ➕ = הזנה מהירה (sheet). */
export function BottomNav() {
  const pathname = usePathname()
  const item = (n: { href: string; label: string; icon: React.ComponentType<{ size?: number }> }) => (
    <Link
      key={n.href}
      href={n.href}
      prefetch={false}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 flex-1 text-[11px] min-h-11',
        pathname === n.href ? 'text-brand' : 'text-text-2',
      )}
    >
      <n.icon size={20} />
      {n.label}
    </Link>
  )
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-surface border-t border-border flex items-stretch z-30 pb-[env(safe-area-inset-bottom)]">
      {MOBILE_NAV.left.map(item)}
      <Link
        href="/quick"
        prefetch={false}
        aria-label="הזנה מהירה"
        className="flex-1 flex items-center justify-center"
      >
        <span className="w-12 h-12 rounded-full bg-brand text-white flex items-center justify-center shadow-lg -mt-4">
          <Plus size={24} />
        </span>
      </Link>
      {MOBILE_NAV.right.map(item)}
    </nav>
  )
}
