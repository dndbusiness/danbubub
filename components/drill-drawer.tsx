'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeft, X } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/ui/cn'

/**
 * <DrillDrawer> — UIUX §4.4.
 * "מגירה מימין (דסקטופ 520px; נייד מלא). כותרת = שם המספר + הסכום.
 *  Breadcrumb בראש. ESC סוגר."
 *
 * UIUX §9: "אין מודלים לצפייה בנתונים — רק drawers."
 */
export function DrillDrawer({
  open,
  onOpenChange,
  title,
  amount,
  breadcrumb = [],
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  amount?: React.ReactNode
  breadcrumb?: string[]
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40 data-[state=open]:animate-in" />
        <Dialog.Content
          dir="rtl"
          className={cn(
            'fixed z-50 top-0 bottom-0 right-0 w-full md:w-[520px] bg-surface shadow-xl flex flex-col',
            'transition-transform duration-200 ease-out',
          )}
        >
          <div className="border-b border-border p-4 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {breadcrumb.length > 0 && (
                <div className="text-xs text-text-3 flex items-center gap-1 mb-1">
                  {breadcrumb.map((b, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <ChevronLeft size={12} />}
                      <span>{b}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}
              <Dialog.Title className="text-base font-semibold text-text truncate">{title}</Dialog.Title>
              {amount && <div className="mt-1">{amount}</div>}
            </div>
            <Dialog.Close
              className="p-2 rounded-[var(--radius-btn)] text-text-2 hover:bg-locked-bg"
              aria-label="סגור"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-auto p-4">{children}</div>
          {footer && <div className="border-t border-border p-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
