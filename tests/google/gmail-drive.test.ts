import { describe, expect, it, vi } from 'vitest'
import { base64url, buildMime, collectAttachments, sendMail } from '@/lib/google/gmail.js'
import { reportFolder } from '@/lib/google/drive.js'

describe('Gmail — בניית הודעה (ב.4, ב.7)', () => {
  it('נושא בעברית מקודד, גוף HTML ב-base64, נמענים', () => {
    const mime = buildMime({ to: ['dan@x', 'h@x'], subject: 'סיכום יומי', html: '<p>שלום</p>' })
    expect(mime).toContain('To: dan@x, h@x')
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('סיכום יומי').toString('base64')}?=`)
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8')
    expect(Buffer.from(mime.split('\r\n\r\n')[1]!, 'base64').toString()).toBe('<p>שלום</p>')
  })
  it('מצורף PDF → multipart/mixed', () => {
    const mime = buildMime({ to: ['a@b'], subject: 's', html: 'x', attachments: [{ fileName: 'סיכום.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF') }] })
    expect(mime).toContain('multipart/mixed')
    expect(mime).toContain('Content-Disposition: attachment')
  })
  it('base64url בלי padding', () => { expect(base64url('hi?')).toBe('aGk_') })
  it('POST ל-messages/send עם raw', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain('/messages/send')
      expect(JSON.parse(String(init?.body)).raw).toMatch(/^[A-Za-z0-9_-]+$/)
      return new Response(JSON.stringify({ id: 'm1' }))
    }) as unknown as typeof fetch
    await expect(sendMail('tok', { to: ['a@b'], subject: 's', html: 'x' }, fetchImpl)).resolves.toBe('m1')
  })
  it('איסוף מצורפים מעץ ה-parts (ב.3)', () => {
    const atts = collectAttachments({ parts: [{ mimeType: 'text/plain' }, { filename: 'inv.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a1', size: 10 } }, { parts: [{ filename: 'x.csv', mimeType: 'text/csv', body: { attachmentId: 'a2' } }] }] })
    expect(atts.map((a) => a.fileName)).toEqual(['inv.pdf', 'x.csv'])
  })
})

describe('Drive — מבנה התיקיות (ב.1)', () => {
  it('הר-אל / כספים / YYYY/MM / <סוג>', () => {
    expect(reportFolder('daily', '2026-09-18')).toEqual(['הר-אל', 'כספים', '2026', '09', 'סיכום-יומי'])
    expect(reportFolder('invoices_received', '2026-09')).toEqual(['הר-אל', 'כספים', '2026', '09', 'חשבוניות', 'received'])
    expect(reportFolder('intake', '')).toEqual(['הר-אל', 'כספים', '00_להזנה'])
  })
})
