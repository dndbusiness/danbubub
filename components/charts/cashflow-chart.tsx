'use client'

import * as React from 'react'
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney } from '@/lib/ui/format'

export interface CashflowPoint { weekStart: string; weekEnd: string; label: string; committed: number; weighted: number }

/**
 * גרף התזרים — UIUX §4.7 + §5.4: "קו כפול (ודאי / +משוקלל), קו אפס, קו מסגרת, נקודה נמוכה מסומנת".
 * צבעים מה-tokens בלבד (UIUX הנחיה 21). ציר הזמן משמאל לימין (UIUX §8).
 * לחיצה על שבוע → onWeek (drill-down — "אין גרף בלי drill-down").
 */
export function CashflowChart({ points, creditLine, lowPoint, onWeek }: {
  points: CashflowPoint[]
  creditLine?: number | null
  lowPoint?: { weekStart: string; balance: number } | null
  onWeek?: (weekStart: string) => void
}) {
  const fmt = (v: number) => formatMoney(v)
  return (
    <div className="h-64 md:h-72 w-full" dir="ltr">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 12, right: 12, left: 8, bottom: 4 }} onClick={(s) => { const p = (s as { activePayload?: { payload: CashflowPoint }[] })?.activePayload?.[0]?.payload; if (p && onWeek) onWeek(p.weekStart) }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} width={44} />
          <Tooltip
            formatter={(v: unknown, name: unknown) => [fmt(Number(v ?? 0)), name === 'committed' ? 'ודאי' : 'ודאי + משוקלל']}
            labelFormatter={(l) => String(l)}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, direction: 'rtl' }}
          />
          <ReferenceLine y={0} stroke="var(--open)" strokeWidth={1.5} />
          {creditLine != null && creditLine > 0 && <ReferenceLine y={-creditLine} stroke="var(--text-3)" strokeDasharray="4 4" label={{ value: 'מסגרת', fontSize: 10, fill: 'var(--text-3)', position: 'insideTopRight' }} />}
          <Line type="monotone" dataKey="weighted" name="weighted" stroke="var(--expected)" strokeWidth={2} dot={false} strokeDasharray="6 3" isAnimationActive={false} />
          <Line type="monotone" dataKey="committed" name="committed" stroke="var(--committed)" strokeWidth={2.5} dot={{ r: 2 }} isAnimationActive={false} />
          {lowPoint && <ReferenceDot x={points.find((p) => p.weekStart === lowPoint.weekStart)?.label} y={lowPoint.balance} r={5} fill={lowPoint.balance < 0 ? 'var(--open)' : 'var(--committed)'} stroke="var(--surface)" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
