import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { llmAvailable } from '@/lib/intake/llm'
import { queueAlive } from '@/lib/crm/ai-queue'
import { dailyCapIls, FEATURES, recentSpend, spendOf } from '@/lib/ai/budget'

export const dynamic = 'force-dynamic'

/** ניצול Claude API בתשלום — לדן בלבד: היום, 30 ימים, לפי שימוש, והתקרה המשותפת */
export async function GET(req: Request) {
  const s = await effectiveSession(req)
  if (!s || s.r !== 'owner') return NextResponse.json({ code: 'permission_denied', message: 'לדן בלבד' }, { status: 403 })
  const [today, days, q] = await Promise.all([spendOf(), recentSpend(30), queueAlive().catch(() => false)])
  return NextResponse.json({ capIls: dailyCapIls(), keyConfigured: llmAvailable(), queueAlive: q, today, days, features: Object.fromEntries(Object.entries(FEATURES).map(([k, f]) => [k, f.label])) })
}
