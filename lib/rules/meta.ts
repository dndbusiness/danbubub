/**
 * Meta (פייסבוק / אינסטגרם) — עלויות קמפיינים לכל חודש, לכל חברה בנפרד (דן, 20/10).
 * משיכה מ-Marketing API: insights ברמת קמפיין, חודש-חודש. כאן — רק ההמרה לטבלת campaigns (טהור, בלי I/O).
 */
export interface MetaInsightRow { campaign_id?: string; campaign_name?: string; spend?: string | number; date_start?: string; actions?: { action_type?: string; value?: string | number }[] }
export interface CampaignDoc {
  id: string; name: string; platform: string; division: string; source: 'meta'; metaId: string; metaAccount: string
  monthly: Record<string, number>; metaLeads: Record<string, number>; spend: number; leadCampaigns: string[]
  marketer?: string; cpl?: number | null; cplNote?: string; cplAt?: string; syncedAt: string; updatedAt: string; [k: string]: unknown
}

export const GRAPH = 'https://graph.facebook.com/v21.0'
const r2 = (x: number) => Math.round(x * 100) / 100
const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'leadgen_grouped']

export function insightsUrl(account: string, since: string, until: string, token: string): string {
  const q = new URLSearchParams({
    level: 'campaign', fields: 'campaign_id,campaign_name,spend,actions', time_increment: 'monthly',
    time_range: JSON.stringify({ since, until }), limit: '500', access_token: token,
  })
  return `${GRAPH}/act_${String(account).replace(/^act_/, '')}/insights?${q}`
}

/** לידים לפי Meta בשורה: הסוג הראשון שקיים מהרשימה (לא סכום — אותו ליד מופיע בכמה סוגים) */
export function leadsOf(row: MetaInsightRow): number {
  const a = row.actions ?? []
  for (const t of LEAD_TYPES) { const x = a.find((y) => y.action_type === t); if (x) return Number(x.value) || 0 }
  return 0
}

/**
 * שורות insights → מסמכי campaigns. מה שהמשתמש ערך במסמך קיים (משווק, קמפיינים מקושרים, עלות לליד) נשמר;
 * חודש שהגיע מ-Meta דורס את אותו חודש, חודשים אחרים נשארים.
 */
export function campaignsFromInsights(rows: MetaInsightRow[], division: string, account: string, existing: Record<string, Partial<CampaignDoc>>, now: string): CampaignDoc[] {
  const by = new Map<string, CampaignDoc>(), seen = new Set<string>()
  for (const r of rows) {
    const cid = String(r.campaign_id ?? '').trim(); if (!cid) continue
    const id = 'meta-' + cid, month = String(r.date_start ?? '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(month)) continue
    const prev = existing[id] ?? {}
    // חשבון מודעות משותף לשתי החברות (division = 'auto'): מה שכבר נקבע בקמפיין (גם ידנית) — נשאר; קמפיין חדש — לפי השם
    const div = division === 'auto' ? String(prev.division || divisionOfCampaign(String(r.campaign_name ?? ''))) : division
    const doc = by.get(id) ?? {
      ...prev, id, name: String(r.campaign_name ?? prev.name ?? cid), platform: 'פייסבוק', division: div, source: 'meta' as const, metaId: cid, metaAccount: account,
      monthly: { ...(prev.monthly ?? {}) }, metaLeads: { ...(prev.metaLeads ?? {}) }, spend: 0,
      leadCampaigns: [...new Set([...(prev.leadCampaigns ?? []), String(r.campaign_name ?? '')].filter(Boolean))],
      syncedAt: now, updatedAt: now,
    }
    const k = id + '|' + month, again = seen.has(k); seen.add(k)
    doc.monthly[month] = r2((again ? doc.monthly[month] ?? 0 : 0) + (Number(r.spend) || 0))
    doc.metaLeads[month] = (again ? doc.metaLeads[month] ?? 0 : 0) + leadsOf(r)
    by.set(id, doc)
  }
  for (const d of by.values()) {
    d.spend = r2(Object.values(d.monthly).reduce((a, b) => a + (Number(b) || 0), 0))
    const L = Object.values(d.metaLeads).reduce((a, b) => a + (Number(b) || 0), 0)
    if (L > 0 && !d.cplManual) { d.cpl = r2(d.spend / L); d.cplNote = 'לפי Meta'; d.cplAt = now.slice(0, 10) }
  }
  return [...by.values()]
}

/** קמפיין של הר-אל השקעות לפי השם (נדל"ן / השקעות / פריסייל); כל השאר — הר-אל פתרונות. ("נכסים" = הלוואה כנגד נכס — פתרונות) */
export const divisionOfCampaign = (name: string): 'finance' | 'realestate' => /נדל["״']?ן|השקע|פריסייל|real\s*estate|invest|presale/i.test(name) ? 'realestate' : 'finance'

/**
 * החשבונות מהסביבה:
 *   META_AD_ACCOUNT — חשבון אחד לשתי החברות (דן, 20/10: act_2166211937175095) → החברה לפי שם הקמפיין
 *   META_AD_ACCOUNT_FINANCE / META_AD_ACCOUNT_REALESTATE — חשבון לכל חברה (אם יפוצל בעתיד)
 * אותו חשבון פעמיים = משותף.
 */
export function metaAccounts(env: Record<string, string | undefined>): { division: string; account: string }[] {
  const clean = (a: string | undefined) => String(a ?? '').trim().replace(/^act_/, '')
  const out: { division: string; account: string }[] = []
  const add = (division: string, a: string | undefined) => { const account = clean(a); if (!account) return
    const hit = out.find((x) => x.account === account); if (hit) { hit.division = 'auto'; return } out.push({ division, account }) }
  add('auto', env.META_AD_ACCOUNT); add('finance', env.META_AD_ACCOUNT_FINANCE); add('realestate', env.META_AD_ACCOUNT_REALESTATE)
  return out
}
