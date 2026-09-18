'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MonthBars, type MonthBar } from '@/components/charts/month-bars'
import { Card } from '@/components/ui/card'

/** SPEC §5.1 — "נגבה לפי חודש: עמודות actual + קו מה שהיה צפוי" ו"פתוח לגביה ודאי/פוטנציאלי". לחיצה → החודש. */
export function HomeCharts({ collected, target }: { collected: { month: string; actual: number; committed: number; expected: number }[]; target: number | null }) {
  const router = useRouter()
  const label = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`
  const bars: MonthBar[] = collected.map((c) => ({ month: c.month, label: label(c.month), actual: c.actual, line: c.actual + c.committed + c.expected }))
  const open: MonthBar[] = collected.map((c) => ({ month: c.month, label: label(c.month), committed: c.committed, expected: c.expected }))
  const go = (m: string) => router.push(`/pnl?period=${m}`)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card><h3 className="text-sm text-text-2 font-medium mb-1">נגבה לפי חודש <span className="text-text-3">· עמודה = בפועל, קו = מה שהיה צפוי</span></h3><MonthBars data={bars} lineLabel="צפוי" target={target} onMonth={go} /></Card>
      <Card><h3 className="text-sm text-text-2 font-medium mb-1">פתוח לגביה <span className="text-text-3">· כחול ודאי / כתום פוטנציאלי</span></h3><MonthBars data={open} onMonth={(m) => router.push(`/deals?period=${m}`)} /></Card>
    </div>
  )
}
