'use client'

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney } from '@/lib/ui/format'

export interface MonthBar { month: string; label: string; actual?: number; committed?: number; expected?: number; line?: number }

/**
 * "עמודות מפוצלות לפי ודאות — הגרף הסטנדרטי של המערכת" (UIUX §4.7).
 * ירוק = בפועל, כחול = ודאי, כתום = פוטנציאל; קו אופציונלי (יעד / מה שהיה צפוי).
 */
export function MonthBars({ data, lineLabel, target, onMonth }: { data: MonthBar[]; lineLabel?: string; target?: number | null; onMonth?: (month: string) => void }) {
  const names: Record<string, string> = { actual: 'בפועל', committed: 'ודאי', expected: 'פוטנציאל', line: lineLabel ?? 'צפוי' }
  return (
    <div className="h-56 w-full" dir="ltr">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} onClick={(s) => { const p = (s as { activePayload?: { payload: MonthBar }[] })?.activePayload?.[0]?.payload; if (p && onMonth) onMonth(p.month) }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} width={44} />
          <Tooltip formatter={(v: unknown, name: unknown) => [formatMoney(Number(v ?? 0)), names[String(name)] ?? String(name)]}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, direction: 'rtl' }} />
          <ReferenceLine y={0} stroke="var(--border)" />
          {target != null && <ReferenceLine y={target} stroke="var(--text-3)" strokeDasharray="4 4" label={{ value: 'יעד', fontSize: 10, fill: 'var(--text-3)', position: 'insideTopLeft' }} />}
          <Bar dataKey="actual" name="actual" stackId="a" fill="var(--actual)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="committed" name="committed" stackId="a" fill="var(--committed)" isAnimationActive={false} />
          <Bar dataKey="expected" name="expected" stackId="a" fill="var(--expected)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          {data.some((d) => d.line !== undefined) && <Line type="monotone" dataKey="line" name="line" stroke="var(--text-2)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
