import { NextResponse } from 'next/server'
import { effectiveSession } from '@/lib/crm/auth'
import { googleAccessToken, googleIntegration } from '@/lib/google/store'
import { calendarTool, driveTool, gmailTool, ToolError } from '@/lib/crm/google-tools.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** הגשר בין הדף לגוגל: אותם שמות כלים כמו בחיבורים של Claude (Gmail / Google Drive / Google Calendar). */
export async function POST(req: Request) {
  if (!(await effectiveSession(req))) return NextResponse.json({ code: 'unauthenticated', message: 'צריך להיכנס' }, { status: 401 })
  let body: { server?: string; tool?: string; input?: Record<string, unknown> }
  try { body = await req.json() } catch { return NextResponse.json({ code: 'invalid_argument', message: 'גוף הבקשה לא JSON' }, { status: 400 }) }
  const server = String(body.server ?? ''), tool = String(body.tool ?? ''), input = body.input ?? {}
  if (!['Gmail', 'Google Drive', 'Google Calendar'].includes(server)) return NextResponse.json({ code: 'server_not_connected', message: `${server} לא מחובר בשרת` }, { status: 404 })
  let token: string
  try { token = await googleAccessToken() } catch (e) { return NextResponse.json({ code: 'server_not_connected', message: (e as Error).message }, { status: 409 }) }
  try {
    const integ = await googleIntegration().catch(() => null)
    const payload = server === 'Gmail' ? await gmailTool(tool, input, token, integ?.connected_email ?? null)
      : server === 'Google Calendar' ? await calendarTool(tool, input, token) : await driveTool(tool, input, token)
    return NextResponse.json({ payload })
  } catch (e) {
    const code = e instanceof ToolError ? e.code : 'upstream_error'
    return NextResponse.json({ code, message: (e as Error).message }, { status: code === 'tool_not_found' ? 404 : code === 'not_granted' ? 403 : 502 })
  }
}
