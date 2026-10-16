import { describe, expect, it } from 'vitest'
import { formatMoney, formatMoneyInline } from '@/lib/ui/format'

/** UIUX §2.2 + הנחיה 25 — מינוס אמיתי, ובידוד כשהסכום יושב בתוך משפט עברי. */
describe('formatMoney', () => {
  it('מדפיס מינוס אמיתי ולא מקף', () => {
    expect(formatMoney(-1580, { cents: false })).toBe('−1,580\u2009₪')
    expect(formatMoney(-1580, { cents: false })).not.toContain('-')
  })

  it('אגורות לפי בקשה', () => {
    expect(formatMoney(1580.5)).toBe('1,580.50\u2009₪')
    expect(formatMoney(1580.5, { cents: false })).toBe('1,581\u2009₪')
  })
})

describe('formatMoneyInline', () => {
  it('עוטף ב-FSI…PDI כדי שהמינוס לא יקפוץ בצד הימני של המספר', () => {
    const s = formatMoneyInline(-1580, { cents: false })
    expect(s.startsWith('⁨')).toBe(true)
    expect(s.endsWith('⁩')).toBe(true)
    expect(s.slice(1, -1)).toBe(formatMoney(-1580, { cents: false }))
  })

  it('גם סכום חיובי מבודד — אותה פונקציה בכל מקום', () => {
    expect(formatMoneyInline(1580, { cents: false })).toBe('⁨1,580\u2009₪⁩')
  })
})
