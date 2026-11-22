/**
 * וואטסאפ — Cloud API הרשמי (Meta). רק התחבורה; התור, ה-retry והלוג ב-lib/jobs/outbox.ts (הנחיה 16).
 * הטוקן בסביבת השרת בלבד (WA_CLOUD_TOKEN) — לא ב-DB ולא בדפדפן.
 */
import { graphError, templatePayload, textPayload, type WaConfig } from '@/lib/rules/wa-cloud'

export interface WaOutPayload { wa?: { kind: 'text' | 'template'; text?: string; name?: string; lang?: string; params?: string[] } }

export async function sendWaCloud(cfg: WaConfig, target: string, body: string, payload: WaOutPayload | null, fetchImpl: typeof fetch = fetch): Promise<string> {
  const w = payload?.wa, json = w?.kind === 'template' && w.name ? templatePayload(target, w.name, w.lang || 'he', w.params || []) : textPayload(target, w?.text ?? body)
  const r = await fetchImpl(`${cfg.base}/${cfg.version}/${cfg.phoneId}/messages`, { method: 'POST', headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' }, body: JSON.stringify(json), signal: AbortSignal.timeout(20000) })
  const j = (await r.json().catch(() => ({}))) as { messages?: { id?: string }[] }
  if (!r.ok) { const e = graphError(r.status, j); throw Object.assign(new Error(e.message), { permanent: e.permanent }) }
  return j.messages?.[0]?.id ?? 'sent'
}
