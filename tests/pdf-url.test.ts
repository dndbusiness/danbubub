import { describe, expect, it } from 'vitest'
import { internalBaseUrl } from '@/lib/pdf.js'

describe('כתובת לרינדור PDF פנימי', () => {
  it('מקומית — localhost', () => { expect(internalBaseUrl({ PORT: '3000' })).toBe('http://localhost:3000') })
  it('ב-Vercel — הכתובת הציבורית (אין localhost), לא כתובת פריסה מוגנת', () => {
    expect(internalBaseUrl({ VERCEL: '1', APP_BASE_URL: 'https://crm.harel.example/', VERCEL_URL: 'x-dpl.vercel.app' })).toBe('https://crm.harel.example')
    expect(internalBaseUrl({ VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'danbubub.vercel.app' })).toBe('https://danbubub.vercel.app')
  })
  it('HAREL_INTERNAL_URL גובר', () => { expect(internalBaseUrl({ VERCEL: '1', HAREL_INTERNAL_URL: 'http://10.0.0.1:3000/', APP_BASE_URL: 'https://x' })).toBe('http://10.0.0.1:3000') })
})
