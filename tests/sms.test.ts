import { describe, expect, it } from 'vitest'
import { firstName, ilMobile, SMS_LIMIT, smsFits, smsLength } from '@/lib/rules/sms.js'
import { sendSlng, slngConfig } from '@/lib/outbox/slng.js'

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
    expect(slngConfig(env)).toEqual({ url: env.SLNG_FORM_URL, fName: 'n', fPhone: 'p', fLink: 'l' })
    expect(slngConfig({ ...env, SLNG_FIELD_LINK: '' })).toBeNull()
    expect(slngConfig({ ...env, SLNG_FORM_URL: 'http://evil.example/x' })).toBeNull()
    expect(slngConfig({ ...env, SLNG_FORM_URL: 'http://127.0.0.1:9/x' })).not.toBeNull()
  })
  it('שליחה: multipart עם שם פרטי, נייד 05… והקישור; 200 = הצליח, אחרת זורק (ה-retry בתור)', async () => {
    const cfg = { url: 'https://slng.example/form', fName: 'n', fPhone: 'p', fLink: 'l' }
    let got: FormData | null = null
    const ok = (async (_u: string, i: RequestInit) => { got = i.body as FormData; return new Response('ok', { status: 200 }) }) as unknown as typeof fetch
    expect(await sendSlng(cfg, { name: 'דנה כהן', phone: '+972521234567', link: 'https://x/s/abc' }, ok)).toBe('slng:200')
    expect(got!.get('n')).toBe('דנה'); expect(got!.get('p')).toBe('0521234567'); expect(got!.get('l')).toBe('https://x/s/abc')
    const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    await expect(sendSlng(cfg, { name: 'א', phone: '0521234567', link: 'x' }, bad)).rejects.toThrow(/SLNG 500/)
    await expect(sendSlng(cfg, { name: 'א', phone: '031234567', link: 'x' }, ok)).rejects.toThrow(/נייד/)
  })
})
