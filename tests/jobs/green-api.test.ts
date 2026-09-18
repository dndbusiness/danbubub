import { describe, expect, it, vi } from 'vitest'
import { greenApiConfig, sendWhatsApp, toChatId } from '@/lib/outbox/green-api.js'

describe('Green-API — תחבורת וואטסאפ (שלב 5)', () => {
  it('בלי מפתחות בסביבה — אין תחבורה (ההודעות נשארות pending)', () => {
    expect(greenApiConfig({})).toBeNull()
    expect(greenApiConfig({ GREEN_API_ID_INSTANCE: '1101', GREEN_API_TOKEN: 't' })?.host).toBe('https://api.green-api.com')
  })

  it('chatId: מספר בינלאומי → @c.us', () => {
    expect(toChatId('972-50-1234567')).toBe('972501234567@c.us')
    expect(toChatId('123@g.us')).toBe('123@g.us')
  })

  it('POST ל-sendMessage עם chatId והודעה; מחזיר idMessage', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.green-api.com/waInstance1101/sendMessage/tok')
      expect(JSON.parse(String(init?.body))).toEqual({ chatId: '972501234567@c.us', message: 'שלום' })
      return new Response(JSON.stringify({ idMessage: 'ABC' }), { status: 200 })
    }) as unknown as typeof fetch
    await expect(sendWhatsApp({ host: 'https://api.green-api.com', idInstance: '1101', token: 'tok' }, '972501234567', 'שלום', fetchImpl)).resolves.toBe('ABC')
  })

  it('כשל HTTP זורק (ה-retry ב-outbox)', async () => {
    const fetchImpl = (async () => new Response('bad token', { status: 401 })) as unknown as typeof fetch
    await expect(sendWhatsApp({ host: 'h', idInstance: 'i', token: 't' }, '9725', 'x', fetchImpl)).rejects.toThrow('Green-API 401')
  })
})
