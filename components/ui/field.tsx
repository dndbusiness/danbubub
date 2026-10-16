import * as React from 'react'
import { cn } from '@/lib/ui/cn'

/** UIUX §4.6 — תווית מעל השדה, לא בתוך. שדות חובה עם נקודה אדומה. */
export function Field({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string
  required?: boolean
  hint?: React.ReactNode
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-sm text-text-2 flex items-center gap-1">
        {label}
        {required && <span className="inline-block w-1.5 h-1.5 rounded-full bg-open" aria-label="חובה" />}
      </span>
      {children}
      {hint && <span className="text-xs text-text-3">{hint}</span>}
      {error && <span className="text-xs text-open">{error}</span>}
    </label>
  )
}

const inputClass =
  'h-10 w-full rounded-[var(--radius-btn)] border border-border bg-surface px-3 text-sm text-text placeholder:text-text-3 focus-visible:border-committed'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClass, 'cursor-pointer', className)} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, 'h-auto min-h-20 py-2', className)} {...props} />
}
