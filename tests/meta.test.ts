import { describe, expect, it } from 'vitest'
import { campaignsFromInsights, divisionOfCampaign, insightsUrl, leadsOf, metaAccounts } from '@/lib/rules/meta'

const now = '2026-10-20T10:00:00.000Z'
describe('Meta — עלויות קמפיינים', () => {
  it('לידים: הסוג הראשון, לא סכום', () => {
    expect(leadsOf({ actions: [{ action_type: 'link_click', value: '50' }, { action_type: 'lead', value: '7' }, { action_type: 'onsite_conversion.lead_grouped', value: '7' }] })).toBe(7)
    expect(leadsOf({})).toBe(0)
  })
  it('חודש-חודש, סה״כ ועלות לליד', () => {
    const d = campaignsFromInsights([
      { campaign_id: '1', campaign_name: 'רכב — אוקטובר', spend: '1000.5', date_start: '2026-10-01', actions: [{ action_type: 'lead', value: '10' }] },
      { campaign_id: '1', campaign_name: 'רכב — אוקטובר', spend: '499.5', date_start: '2026-09-01', actions: [{ action_type: 'lead', value: '5' }] },
    ], 'finance', '123', {}, now)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ id: 'meta-1', division: 'finance', platform: 'פייסבוק', monthly: { '2026-10': 1000.5, '2026-09': 499.5 }, metaLeads: { '2026-10': 10, '2026-09': 5 }, spend: 1500, cpl: 100, leadCampaigns: ['רכב — אוקטובר'] })
  })
  it('שומר מה שנערך ידנית; חודש מ-Meta דורס רק את אותו חודש', () => {
    const d = campaignsFromInsights([{ campaign_id: '1', campaign_name: 'X', spend: 300, date_start: '2026-10-01' }, { campaign_id: '1', campaign_name: 'X', spend: 50, date_start: '2026-09-01' }], 'finance', '123',
      { 'meta-1': { marketer: 'אבינועם', leadCampaigns: ['קמפיין בטבלה'], monthly: { '2026-08': 200, '2026-10': 999 }, cpl: 40, cplManual: true } as never }, now)
    expect(d[0]).toMatchObject({ marketer: 'אבינועם', monthly: { '2026-08': 200, '2026-09': 50, '2026-10': 300 }, spend: 550, cpl: 40, leadCampaigns: ['קמפיין בטבלה', 'X'] })
  })
  it('חשבונות לפי חברה', () => {
    expect(metaAccounts({ META_AD_ACCOUNT_FINANCE: 'act_111', META_AD_ACCOUNT_REALESTATE: ' 222 ' })).toEqual([{ division: 'finance', account: '111' }, { division: 'realestate', account: '222' }])
    expect(metaAccounts({})).toEqual([])
    expect(metaAccounts({ META_AD_ACCOUNT: 'act_2166211937175095' })).toEqual([{ division: 'auto', account: '2166211937175095' }])
    expect(metaAccounts({ META_AD_ACCOUNT_FINANCE: '5', META_AD_ACCOUNT_REALESTATE: 'act_5' })).toEqual([{ division: 'auto', account: '5' }])
  })
  it('חשבון משותף: החברה לפי שם הקמפיין; מה שנקבע בקמפיין קיים — נשאר', () => {
    expect(divisionOfCampaign('השקעות נדל"ן — פריסייל צפון')).toBe('realestate')
    expect(divisionOfCampaign('הלוואה כנגד נכס — אוקטובר')).toBe('finance')
    const rows = [{ campaign_id: '1', campaign_name: 'נדל"ן — יד שנייה', spend: 100, date_start: '2026-10-01' }, { campaign_id: '2', campaign_name: 'רכב', spend: 50, date_start: '2026-10-01' }, { campaign_id: '3', campaign_name: 'השקעות', spend: 10, date_start: '2026-10-01' }]
    const d = campaignsFromInsights(rows, 'auto', '216', { 'meta-3': { division: 'finance' } as never }, now)
    expect(d.map((x) => x.division)).toEqual(['realestate', 'finance', 'finance'])
  })
  it('כתובת', () => {
    const u = new URL(insightsUrl('act_111', '2026-05-01', '2026-10-20', 'TOK'))
    expect(u.pathname).toBe('/v21.0/act_111/insights'); expect(u.searchParams.get('time_increment')).toBe('monthly'); expect(JSON.parse(u.searchParams.get('time_range')!)).toEqual({ since: '2026-05-01', until: '2026-10-20' })
  })
})
