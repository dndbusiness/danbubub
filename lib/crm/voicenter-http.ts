/** קריאת בקשה מוויאסנטר (JSON / טופס / GET) ובדיקת המפתח — משותף לכל הכתובות שוויאסנטר קוראת אליהן */
import { keyOk } from '@/lib/crm/inbound'

/** VOICENTER_WEBHOOK_SECRET (חדש); VOICENTER_SECRET — הכתובת הישנה של ה-CDR ממשיכה לעבוד */
export const webhookSecrets = () => [process.env.VOICENTER_WEBHOOK_SECRET, process.env.VOICENTER_SECRET].filter((x): x is string => !!x)

export function keyFrom(req: Request): string | null {
  const url = new URL(req.url)
  return req.headers.get('x-api-key') ?? url.searchParams.get('key')
}
export const webhookOk = (req: Request) => { const k = keyFrom(req); return webhookSecrets().some((s) => keyOk(k, s)) }

export async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  const url = new URL(req.url)
  if (req.method === 'GET') { const o = Object.fromEntries(url.searchParams.entries()); delete o.key; return o }
  const ct = req.headers.get('content-type') ?? '', txt = await req.text()
  if (!txt.trim()) return {}
  try {
    if (ct.includes('json') || /^\s*[{[]/.test(txt)) { const j = JSON.parse(txt); return Array.isArray(j) ? (j[0] ?? {}) : j }
    return Object.fromEntries(new URLSearchParams(txt).entries())
  } catch { return null }
}
