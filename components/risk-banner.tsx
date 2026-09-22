import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'

/**
 * <RiskBanner> — UIUX §4.8 / ADDENDUM ב.11.
 * "פס אדום כהה בראש כל מסך: 'תזרים במצב סיכון — נקודה נמוכה −12,000 ₪ ב-8/11'".
 * מוצג רק כש-`v_risk_mode.is_risk_mode`.
 */
export function RiskBanner({ message, href = '/cashflow' }: { message: string; href?: string }) {
  return (
    <div role="alert" className="bg-danger-banner text-white px-4 py-2 text-sm flex items-center gap-2">
      <AlertTriangle size={16} />
      <span className="font-medium">תזרים במצב סיכון</span>
      <span className="opacity-90">— {message}</span>
      <Link href={href} prefetch={false} className="ms-auto underline underline-offset-2">פתח תזרים</Link>
    </div>
  )
}
