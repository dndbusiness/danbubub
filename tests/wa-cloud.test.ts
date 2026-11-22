import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { fillTemplate, signatureOk, fromWa, graphError, parseWebhook, templatePayload, templateVars, textPayload, toWa, waConfig, windowLeftMin, windowOpen } from '@/lib/rules/wa-cloud'

const NOW = Date.parse('2026-11-22T12:00:00Z')
describe('וואטסאפ — Cloud API', () => {
  it('מספרים: CRM ↔ וואטסאפ', () => { expect(toWa('050-123-4567')).toBe('972501234567'); expect(toWa('+972 50 1234567')).toBe('972501234567'); expect(fromWa('972501234567')).toBe('0501234567') })
  it('הגדרות: בלי טוקן או מספר — כבוי', () => { expect(waConfig({})).toBeNull(); expect(waConfig({ WA_CLOUD_TOKEN: 't', WA_PHONE_NUMBER_ID: '1' })?.version).toBe('v21.0') })
  it('חלון 24 שעות', () => {
    expect(windowOpen('2026-11-21T13:00:00Z', NOW)).toBe(true); expect(windowOpen('2026-11-21T11:00:00Z', NOW)).toBe(false); expect(windowOpen(null, NOW)).toBe(false)
    expect(windowLeftMin('2026-11-21T13:00:00Z', NOW)).toBe(60)
  })
  it('webhook: הודעת טקסט, תמונה עם כיתוב, כפתור, וסטטוסים', () => {
    const body = { object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P1' }, contacts: [{ wa_id: '972501234567', profile: { name: 'דני' } }],
      messages: [{ id: 'm1', from: '972501234567', timestamp: '1795387200', type: 'text', text: { body: 'שלום, אני צריך משכנתא' } },
        { id: 'm2', from: '972501234567', timestamp: '1795387260', type: 'image', image: { id: 'MED1', mime_type: 'image/jpeg', caption: 'תלוש' }, context: { id: 'out1' } },
        { id: 'm3', from: '972501234567', timestamp: '1795387300', type: 'button', button: { text: 'כן, מעוניין' } }],
      statuses: [{ id: 'out1', status: 'read', timestamp: '1795387400', recipient_id: '972501234567' }, { id: 'out2', status: 'failed', timestamp: '1795387400', recipient_id: '9725', errors: [{ code: 131026, title: 'Message undeliverable' }] }] } }] }] }
    const R = parseWebhook(body)
    expect(R.phoneIds).toEqual(['P1'])
    expect(R.messages.map((m) => [m.id, m.name, m.type, m.text])).toEqual([['m1', 'דני', 'text', 'שלום, אני צריך משכנתא'], ['m2', 'דני', 'image', 'תלוש'], ['m3', 'דני', 'button', 'כן, מעוניין']])
    expect(R.messages[1]!.media).toEqual({ id: 'MED1', mime: 'image/jpeg', caption: 'תלוש', filename: '' }); expect(R.messages[1]!.replyTo).toBe('out1')
    expect(R.messages[0]!.at).toBe(new Date(1795387200000).toISOString())
    expect(R.statuses).toEqual([{ id: 'out1', status: 'read', at: new Date(1795387400000).toISOString(), to: '972501234567', error: null }, { id: 'out2', status: 'failed', at: new Date(1795387400000).toISOString(), to: '9725', error: 'Message undeliverable' }])
  })
  it('שליחה: טקסט ותבנית עם משתנים', () => {
    expect(textPayload('0501234567', 'היי')).toMatchObject({ to: '972501234567', type: 'text', text: { body: 'היי' } })
    expect(templatePayload('0501234567', 'docs_reminder', 'he', ['דני', '3'])).toEqual({ messaging_product: 'whatsapp', to: '972501234567', type: 'template', template: { name: 'docs_reminder', language: { code: 'he' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'דני' }, { type: 'text', text: '3' }] }] } })
    const comps = [{ type: 'HEADER', text: 'x' }, { type: 'BODY', text: 'שלום {{1}}, חסרים {{2}} מסמכים. {{1}}' }]
    expect(templateVars(comps)).toBe(2); expect(fillTemplate(comps[1]!.text, ['דני', '3'])).toBe('שלום דני, חסרים 3 מסמכים. דני')
  })
  it('שגיאות Graph בעברית', () => {
    expect(graphError(400, { error: { code: 131047, message: 'Re-engagement message' } })).toEqual({ message: 'עברו 24 שעות מההודעה האחרונה של הלקוח — אפשר לשלוח רק תבנית מאושרת', permanent: true })
    expect(graphError(429, { error: { code: 130429 } }).permanent).toBe(false)
  })
  it('חתימת ה-webhook', () => {
    const raw = '{"a":1}', sig = 'sha256=' + createHmac('sha256', 'S').update(raw).digest('hex')
    expect(signatureOk(raw, sig, 'S')).toBe(true); expect(signatureOk(raw, sig, 'X')).toBe(false); expect(signatureOk(raw, null, 'S')).toBe(false)
  })
})
