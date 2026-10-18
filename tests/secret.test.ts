import { describe, expect, it } from 'vitest'
import { envSecret, secretEq } from '@/lib/secret'

describe('סוד משותף — רווחים ושורות בקצוות לא נחשבים (18/10)', () => {
  it('secretEq', () => {
    expect(secretEq('abc123XYZ', 'abc123XYZ\n')).toBe(true)
    expect(secretEq(' abc123XYZ', 'abc123XYZ \r\n')).toBe(true)
    expect(secretEq('abc123XYZ', 'abc123XYz')).toBe(false)
    expect(secretEq('abc 123', 'abc123')).toBe(false)
    expect(secretEq('', '')).toBe(false)
    expect(secretEq('x', null)).toBe(false)
  })
  it('envSecret', () => {
    expect(envSecret('S', { S: '  v1\n' })).toBe('v1')
    expect(envSecret('S', { S: '   ' })).toBeNull()
    expect(envSecret('S', {})).toBeNull()
  })
})
