import { describe, it, expect } from 'vitest'
import { driveTool } from '@/lib/crm/google-tools'

describe('Drive copy_file (submission review folder)', () => {
  it('copies a file into the target folder with its title', async () => {
    let call: { url: string; init?: RequestInit } | null = null
    const fake = (async (url: string, init?: RequestInit) => { call = { url: String(url), init }; return new Response(JSON.stringify({ id: 'copy1', name: 'תלוש.pdf', mimeType: 'application/pdf', webViewLink: 'https://drive/x' }), { status: 200, headers: { 'content-type': 'application/json' } }) }) as typeof fetch
    const r = await driveTool('copy_file', { fileId: 'src1', parentId: 'fold1', title: 'תלוש.pdf' }, 'tok', fake)
    expect(r).toEqual({ id: 'copy1', title: 'תלוש.pdf', mimeType: 'application/pdf', viewUrl: 'https://drive/x' })
    expect(call!.url).toContain('/files/src1/copy')
    expect(call!.init?.method).toBe('POST')
    expect(JSON.parse(String(call!.init?.body))).toEqual({ name: 'תלוש.pdf', parents: ['fold1'] })
  })
  it('requires a fileId', async () => {
    await expect(driveTool('copy_file', {}, 'tok', (async () => new Response('{}')) as typeof fetch)).rejects.toThrow()
  })
})
