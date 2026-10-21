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
  it('הגשה לגוף: שם קובץ בעברית מקודד בשתי הכותרות, ושורות base64 של עד 76 תווים (מגבלת 998 של SMTP)', () => {
    const big = Buffer.alloc(5000, 7)
    const mime = buildMime({ to: ['fund@x'], cc: ['finance@x'], subject: 'הגשת תיק — לקוח לדוגמה — הר-אל פתרונות מימון — בקשה להלוואה', html: 'x'.repeat(3000), attachments: [{ fileName: 'תלוש שכר.pdf', mimeType: 'application/pdf', content: big }] })
    expect(mime).toContain('Cc: finance@x')
    expect(mime).toContain(`name="=?UTF-8?B?${Buffer.from('תלוש שכר.pdf').toString('base64')}?="`)
    expect(mime).toContain(`filename="=?UTF-8?B?${Buffer.from('תלוש שכר.pdf').toString('base64')}?="`)
    expect(Math.max(...mime.split('\r\n').map((l) => l.length))).toBeLessThanOrEqual(998)
    expect(/[^\x00-\x7F]/.test(mime)).toBe(false)
    // הקובץ חוזר שלם אחרי פענוח
    const att = mime.split('\r\n\r\n')[3]!.split('\r\n--')[0]!
    expect(Buffer.from(att.replace(/\r\n/g, ''), 'base64').equals(big)).toBe(true)
    // הנושא הארוך מתפרק ל-encoded-words ומתחבר חזרה
    const subj = mime.split('\r\n').filter((l, i, A) => l.startsWith('Subject:') || (A.slice(0, i).some((x) => x.startsWith('Subject:')) && l.startsWith(' ') && !A.slice(0, i).some((x) => x.startsWith('MIME'))))
    expect(subj.join('').replace(/^Subject: /, '').split(/\s+/).map((w) => Buffer.from(w.slice(10, -2), 'base64').toString()).join('')).toBe('הגשת תיק — לקוח לדוגמה — הר-אל פתרונות מימון — בקשה להלוואה')
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
