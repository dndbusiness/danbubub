import { NextResponse } from 'next/server'
import { ownerIdentity } from '@/lib/crm/store'
import { googleIntegration } from '@/lib/google/store'

export const dynamic = 'force-dynamic'

/** מי מחובר + מה מצב גוגל. עד שלב ההתחברות האישית: מי שעבר את שער הכניסה הוא דן, והדף עצמו מבחין בין דן / ניסים / הדס במסך הנעילה שלו. */
export async function GET() {
  const [me, g] = await Promise.all([ownerIdentity(), googleIntegration().catch(() => null)])
  return NextResponse.json({ me, google: g && g.status === 'connected' ? { email: g.connected_email, scopes: g.scopes } : null })
}
