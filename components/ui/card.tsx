import * as React from 'react'
import { cn } from '@/lib/ui/cn'

export type Division = 'realestate' | 'finance' | 'shared' | 'private'

const stripe: Record<Division, string> = {
  realestate: 'border-e-div-realestate',
  finance: 'border-e-div-finance',
  shared: 'border-e-div-shared',
  private: 'border-e-div-private',
}

/**
 * כרטיס — UIUX §2.3: רדיוס 12, padding 20 (נייד 16), צל עדין.
 * `division` מוסיף פס 3px בצד ימין בצבע הפעילות (UIUX §1.5).
 */
export function Card({
  division,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { division?: Division }) {
  return (
    <div
      className={cn(
        'bg-surface rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 md:p-5',
        division && `border-e-[3px] ${stripe[division]}`,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm text-text-2 font-medium', className)} {...props} />
}
