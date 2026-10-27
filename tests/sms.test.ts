import { describe, expect, it } from 'vitest'
import { firstName, ilMobile, SMS_LIMIT, smsFits, smsLength, smsText } from '@/lib/rules/sms.js'
import { parseSlngReply, sendSlng, slngConfig, SLNG_API_URL } from '@/lib/outbox/slng.js'

describe('SMS ללקוח (SLNG, דן 21/10)', () => {
  it('נייד ישראלי בלבד, בפורמט 05XXXXXXXX', () => {
    expect(ilMobile('053-335-1395')).toBe('0533351395')
    expect(ilMobile('+972533351395')).toBe('0533351395')
    expect(ilMobile('972-53-3351395')).toBe('0533351395')
    expect(ilMobile('03-1234567')).toBeNull()
    expect(ilMobile('053335139')).toBeNull()
    expect(ilMobile(null)).toBeNull()
  })
  it('שם פרטי מהשם המלא', () => { expect(firstName('דן כהן')).toBe('דן'); expect(firstName('  ')).toBe('') })
  it('אורך: קישור חתימה רגיל נכנס; קישור ארוך מדי — לא', () => {
    const link = 'https://danbubub.vercel.app/s/' + 'a'.repeat(32)
    expect(smsFits('דנה כהן', link)).toBe(true)
    expect(smsLength('דנה', link)).toBeLessThan(SMS_LIMIT)
    expect(smsFits('דנה', 'https://x.co/' + 'a'.repeat(260))).toBe(false)
  })
  it('הגדרות: ארבעת המשתנים, https (או שרת מקומי לבדיקות)', () => {
    const env = { SLNG_FORM_URL: 'https://slng.example/form', SLNG_FIELD_NAME: 'n', SLNG_FIELD_PHONE: 'p', SLNG_FIELD_LINK: 'l' }
    expect(slngConfig(env)).toEqual({ mode: 'form', url: env.SLNG_FORM_URL, fName: 'n', fPhone: 'p', fLink: 'l' })
    expect(slngConfig({ ...env, SLNG_FIELD_LINK: '' })).toBeNull()
    expect(slngConfig({ ...env, SLNG_FORM_URL: 'http://evil.example/x' })).toBeNull()
    expect(slngConfig({ ...env, SLNG_FORM_URL: 'http://127.0.0.1:9/x' })).not.toBeNull()
  })
  it('שליחה: multipart עם שם פרטי, נייד 05… והקישור; 200 = הצליח, אחרת זורק (ה-retry בתור)', async () => {
    const cfg = { mode: 'form' as const, url: 'https://slng.example/form', fName: 'n', fPhone: 'p', fLink: 'l' }
    let got: FormData | null = null
    const ok = (async (_u: string, i: RequestInit) => { got = i.body as FormData; return new Response('ok', { status: 200 }) }) as unknown as typeof fetch
    expect(await sendSlng(cfg, { name: 'דנה כהן', phone: '+972521234567', link: 'https://x/s/abc' }, ok)).toBe('slng:200')
    expect(got!.get('n')).toBe('דנה'); expect(got!.get('p')).toBe('0521234567'); expect(got!.get('l')).toBe('https://x/s/abc')
    const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    await expect(sendSlng(cfg, { name: 'א', phone: '0521234567', link: 'x' }, bad)).rejects.toThrow(/SLNG 500/)
    await expect(sendSlng(cfg, { name: 'א', phone: '031234567', link: 'x' }, ok)).rejects.toThrow(/נייד/)
  })
  it('הנוסח: שם פרטי והקישור, בלי מספר לשאלות (דן 27/10) — והאורך זהה ל-smsLength', () => {
    const link = 'https://danbubub.vercel.app/s/abc'
    expect(smsText('דנה כהן', link)).toBe('שלום דנה, מצורף מסמך לחתימה מהראל: ' + link)
    expect(smsText('דנה כהן', link)).not.toMatch(/לשאלות|\d{3}-\d{7}/)
    expect(smsText('דנה כהן', link).length).toBe(smsLength('דנה כהן', link))
  })
})

describe('SLNG API (דן 27/10 — API_UserGuide §2)', () => {
  const api = { SLNG_API_USER: 'u@example.com', SLNG_API_PASSWORD: 'secret', SLNG_FROM: '0533351395' }
  it('הגדרות: שם משתמש + סיסמה + שולח → API (גובר על הטופס); שולח לא תקין → לא API', () => {
    expect(slngConfig(api)).toEqual({ mode: 'api', url: SLNG_API_URL, user: 'u@example.com', password: 'secret', from: '0533351395' })
    expect(slngConfig({ ...api, SLNG_FROM: 'HarEl' })).toMatchObject({ mode: 'api', from: 'HarEl' })
    expect(slngConfig({ ...api, SLNG_FROM: 'שם בעברית' })).toBeNull()
    expect(slngConfig({ ...api, SLNG_FROM: 'TooLongSender1' })).toBeNull()
    expect(slngConfig({ ...api, SLNG_API_URL: 'http://evil.example/x' })).toBeNull()
    expect(slngConfig({ ...api, SLNG_FORM_URL: 'https://slng.example/form', SLNG_FIELD_NAME: 'n', SLNG_FIELD_PHONE: 'p', SLNG_FIELD_LINK: 'l' })).toMatchObject({ mode: 'api' })
  })
  it('תשובה: רגילה, מקודדת ב-URL, ושגיאה', () => {
    expect(parseSlngReply('{"Status":true,"Description":"Command received successfully","GeneralGUID":"g1"}')).toEqual({ ok: true, description: 'Command received successfully', guid: 'g1' })
    expect(parseSlngReply(encodeURIComponent('{"Status":false,"Description":"Username and/or Password are not valid","GeneralGUID":""}'))).toMatchObject({ ok: false, description: 'Username and/or Password are not valid' })
    expect(parseSlngReply('<html>').ok).toBe(false)
  })
  it('שליחה: JSON עם שם משתמש, סיסמה, שולח, נוסח ונייד 05…; Status=false זורק עם התיאור', async () => {
    const cfg = slngConfig(api)!
    let sent: Record<string, unknown> | null = null, url = '', ct = ''
    const ok = (async (u: string, i: RequestInit) => { url = u; ct = String((i.headers as Record<string, string>)['content-type']); sent = JSON.parse(String(i.body)); return new Response('{"Status":true,"Description":"Command received successfully","GeneralGUID":"abc-1"}', { status: 200 }) }) as unknown as typeof fetch
    expect(await sendSlng(cfg, { name: 'דנה כהן', phone: '+972521234567', link: 'https://x/s/abc' }, ok)).toBe('slng:abc-1')
    expect(url).toBe(SLNG_API_URL); expect(ct).toMatch(/application\/json/)
    expect(sent).toMatchObject({ Username: 'u@example.com', Password: 'secret', FromMobile: '0533351395', MsgBody: smsText('דנה', 'https://x/s/abc'), Mobiles: [{ Mobile: '0521234567' }] })
    const no = (async () => new Response('{"Status":false,"Description":"Your account is closed, please contact SLNG support team"}', { status: 200 })) as unknown as typeof fetch
    await expect(sendSlng(cfg, { name: 'א', phone: '0521234567', link: 'x' }, no)).rejects.toThrow(/account is closed/)
    const down = (async () => new Response('err', { status: 503 })) as unknown as typeof fetch
    await expect(sendSlng(cfg, { name: 'א', phone: '0521234567', link: 'x' }, down)).rejects.toThrow(/SLNG 503/)
  })
})
