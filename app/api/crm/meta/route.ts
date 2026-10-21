import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { effectiveSession } from '@/lib/crm/auth'
import { writeDoc } from '@/lib/crm/store'
import { campaignsFromInsights, insightsUrl, metaAccounts, type CampaignDoc, type MetaInsightRow } from '@/lib/rules/meta'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * חיבור ישיר ל-Meta (דן, 20/10): עלויות הקמפיינים בפייסבוק, חודש-חודש, לכל חברה בנפרד — נכנסות לטבלת הקמפיינים
 * ומשם לניתוח העלויות, ההמרה וההתחשבנות. משיכה בלחיצה (או כשנכנסים לשיווק והמשיכה האחרונה ישנה) — אין ג'וב ברקע.
 * סביבה: META_ACCESS_TOKEN (System User, הרשאת ads_read), META_AD_ACCOUNT_FINANCE, META_AD_ACCOUNT_REALESTATE.
 */
const configured = () => !!process.env.META_ACCESS_TOKEN && metaAccounts(process.env).length > 0

export async function GET(req: Request) {
  const s = await effectiveSession(req)
  if (!s || s.r !== 'owner') return NextResponse.json({ enabled: false })
  return NextResponse.json({ enabled: configured(), accounts: metaAccounts(process.env).map((a) => a.division) })
}

export async function POST(req: Request) {
  const s = await effectiveSession(req)
  if (!s || s.r !== 'owner') return NextResponse.json({ code: 'permission_denied', message: 'רק דן' }, { status: 403 })
  if (!configured()) return NextResponse.json({ code: 'failed_precondition', message: 'Meta לא מחובר — חסרים בשרת META_ACCESS_TOKEN ומספרי חשבונות המודעות' }, { status: 412 })
  const now = new Date(), until = now.toISOString().slice(0, 10)
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString().slice(0, 10)
  const token = process.env.META_ACCESS_TOKEN!, at = now.toISOString(), out: { division: string; campaigns: number; spend: number; error?: string }[] = []
  for (const { division, account } of metaAccounts(process.env)) {
    try {
      const rows: MetaInsightRow[] = []
      let url: string | null = insightsUrl(account, since, until, token)
      for (let i = 0; url && i < 20; i++) {
        const r = await fetch(url, { signal: AbortSignal.timeout(20000) })
        const j = await r.json().catch(() => ({})) as { data?: MetaInsightRow[]; paging?: { next?: string }; error?: { message?: string } }
        if (!r.ok || j.error) throw new Error(j.error?.message || 'Meta החזיר ' + r.status)
        rows.push(...(j.data ?? [])); url = j.paging?.next ?? null
      }
      const ids = [...new Set(rows.map((x) => 'meta-' + x.campaign_id).filter((x) => x !== 'meta-undefined'))]
      const prev = ids.length ? await sql<{ doc_id: string; data: Partial<CampaignDoc> }[]>`select doc_id, data from crm_docs where coll = 'campaigns' and deleted_at is null and doc_id = any(${ids}::text[])` : []
      const docs = campaignsFromInsights(rows, division, account, Object.fromEntries(prev.map((p) => [p.doc_id, p.data])), at)
      for (const d of docs) await writeDoc('campaigns/' + d.id, 'set', d)
      out.push({ division, campaigns: docs.length, spend: Math.round(docs.reduce((a, d) => a + Object.entries(d.monthly).filter(([m]) => m >= since.slice(0, 7)).reduce((b, [, v]) => b + v, 0), 0)) })
    } catch (e) {
      // הטוקן לא נכתב להודעה (Meta לא מחזיר אותו), רק הסיבה
      out.push({ division, campaigns: 0, spend: 0, error: (e as Error).message.slice(0, 300) })
    }
  }
  await writeDoc('settings/main', 'update', { metaSync: { at, since, result: out } })
  return NextResponse.json({ ok: out.every((x) => !x.error), since, result: out })
}
