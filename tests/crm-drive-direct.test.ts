import { describe, expect, it } from 'vitest'
import { fileStream, uploadSession } from '@/lib/crm/drive-direct.js'

/** קבצים ישירות בין הדפדפן לדרייב — בלי מגבלת 4.5MB של Vercel (דן 29/10). fetch מדומה. */
describe('העלאה נמשכת', () => {
  it('פותח session עם השם, התיקייה, הסוג וה-Origin של הדף, ומחזיר את ה-Location', async () => {
    let got: { url: string; init: RequestInit } | null = null
    const f = (async (url: string, init: RequestInit) => { got = { url, init }; return new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc' } }) }) as unknown as typeof fetch
    const url = await uploadSession('tok', { title: 'דנה — תלוש.pdf', mimeType: 'application/pdf', parentId: '1AbCdEfGhIjKlMnOp', size: 5_000_000 }, 'https://danbubub.vercel.app', f)
    expect(url).toMatch(/upload_id=abc$/)
    const h = got!.init.headers as Record<string, string>
    expect(got!.url).toMatch(/uploadType=resumable/); expect(h.authorization).toBe('Bearer tok'); expect(h.origin).toBe('https://danbubub.vercel.app')
    expect(h['x-upload-content-type']).toBe('application/pdf'); expect(h['x-upload-content-length']).toBe('5000000')
    expect(JSON.parse(String(got!.init.body))).toEqual({ name: 'דנה — תלוש.pdf', parents: ['1AbCdEfGhIjKlMnOp'] })
  })
  it('שגיאת הרשאה → not_granted; תיקייה לא תקינה → invalid_argument; בלי Location → שגיאה', async () => {
    const no = (async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch
    await expect(uploadSession('t', { title: 'x' }, null, no)).rejects.toMatchObject({ code: 'not_granted' })
    await expect(uploadSession('t', { title: 'x', parentId: "a' or 1=1" }, null, no)).rejects.toMatchObject({ code: 'invalid_argument' })
    const noLoc = (async () => new Response('', { status: 200 })) as unknown as typeof fetch
    await expect(uploadSession('t', { title: 'x' }, null, noLoc)).rejects.toThrow(/כתובת העלאה/)
  })
})

describe('הורדה כזרם', () => {
  it('קובץ רגיל — alt=media; מסמך של גוגל — export ל-PDF', async () => {
    const calls: string[] = []
    const mk = (mime: string) => (async (url: string) => { calls.push(url); return url.includes('fields=') ? Response.json({ name: 'a.pdf', mimeType: mime }) : new Response('BYTES') }) as unknown as typeof fetch
    const a = await fileStream('t', '1AbCdEfGhIjKlMnOp', null, mk('application/pdf'))
    expect(a.mimeType).toBe('application/pdf'); expect(await new Response(a.body).text()).toBe('BYTES'); expect(calls[1]).toMatch(/alt=media/)
    calls.length = 0
    const b = await fileStream('t', '1AbCdEfGhIjKlMnOp', null, mk('application/vnd.google-apps.document'))
    expect(b.mimeType).toBe('application/pdf'); expect(calls[1]).toMatch(/\/export\?mimeType=application%2Fpdf/)
  })
  it('מזהה לא תקין נדחה לפני שפונים לגוגל', async () => {
    await expect(fileStream('t', '../etc', null)).rejects.toMatchObject({ code: 'invalid_argument' })
  })
})
