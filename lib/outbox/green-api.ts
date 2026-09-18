/**
 * Green-API — שליחת וואטסאפ (SPEC §9 שלב 5). רק התחבורה; התור, ה-retry והלוג ב-lib/jobs/outbox.ts.
 * מפתחות בסביבת השרת בלבד (הנחיה 15 — אין סודות ב-DB).
 */
export interface GreenApiConfig { host: string; idInstance: string; token: string }

export function greenApiConfig(env: Record<string, string | undefined> = process.env): GreenApiConfig | null {
  if (!env.GREEN_API_ID_INSTANCE || !env.GREEN_API_TOKEN) return null
  return { host: env.GREEN_API_HOST ?? 'https://api.green-api.com', idInstance: env.GREEN_API_ID_INSTANCE, token: env.GREEN_API_TOKEN }
}

/** 972501234567 → 972501234567@c.us ; מזהה קבוצה נשאר כמו שהוא. */
export function toChatId(target: string): string {
  return target.includes('@') ? target : `${target.replace(/\D/g, '')}@c.us`
}

/** שליחת הודעה אחת. זורק בכשל — ה-retry ב-flushOutbox. */
export async function sendWhatsApp(cfg: GreenApiConfig, target: string, message: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${cfg.host}/waInstance${cfg.idInstance}/sendMessage/${cfg.token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chatId: toChatId(target), message }),
  })
  if (!res.ok) throw new Error(`Green-API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json().catch(() => ({}))) as { idMessage?: string }
  return data.idMessage ?? 'sent'
}
