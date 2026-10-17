import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { sessionIdentity } from '@/lib/crm/store'
import { googleIntegration } from '@/lib/google/store'

export const dynamic = 'force-dynamic'

/**
 * מי מחובר + מה מצב גוגל. כל עובד מקבל את עצמו (חבר הצוות שלו), לא את דן — כך "נוצר על ידי",
 * יום העבודה, "התיקים שלי" וההתראות שייכים למי שבאמת עובד. דן / השומר / מערכת בלי נעילה = הבעלים.
 */
export async function GET(req: Request) {
  const s = await effectiveSession(req)
  const [me, g] = await Promise.all([sessionIdentity(s), googleIntegration().catch(() => null)])
  return NextResponse.json({ me, google: g && g.status === 'connected' ? { email: g.connected_email, scopes: g.scopes } : null })
}
