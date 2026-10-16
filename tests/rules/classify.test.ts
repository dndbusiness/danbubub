import { describe, expect, it } from 'vitest'
import { classify, classifyBatch, findConflicts, normalizeDescription, proposeRule, type ClassificationRule } from '@/lib/rules/classify.js'

const rule = (over: Partial<ClassificationRule> & { id: string; pattern: string }): ClassificationRule => ({
  isRegex: false, priority: 100, active: true, ...over,
})

describe('מנוע כללים — SPEC §4.4', () => {
  const rules: ClassificationRule[] = [
    rule({ id: 'r-pharm', pattern: 'super pharm', setCategoryId: 'cat-office', setDivision: 'finance', setTxClass: 'business' }),
    rule({ id: 'r-fuel', pattern: 'paz|sonol|delek', isRegex: true, setCategoryId: 'cat-car', setTxClass: 'vehicle' }),
    rule({ id: 'r-nissim-card', pattern: 'wolt', accountId: 'acc-nissim', setNature: 'advance', setDivision: 'finance', priority: 10 }),
    rule({ id: 'r-wolt-generic', pattern: 'wolt', setCategoryId: 'cat-food', setTxClass: 'private', priority: 50 }),
    rule({ id: 'r-off', pattern: 'bezeq', active: false, setCategoryId: 'cat-tel' }),
  ]

  it('הכלה בטקסט, לא תלוי רישיות ורווחים', () => {
    expect(classify({ description: 'SUPER  PHARM 1234' }, rules)?.categoryId).toBe('cat-office')
    expect(normalizeDescription("SUPER  PHARM 'סניף'")).toBe('super pharm סניף')
  })

  it('regex', () => {
    expect(classify({ description: 'DELEK MENTA 55' }, rules)?.txClass).toBe('vehicle')
  })

  it('כלל לחשבון מסוים גובר, ורק באותו חשבון (הכרטיס האישי של ניסים = מקדמה)', () => {
    expect(classify({ description: 'WOLT TLV', accountId: 'acc-nissim' }, rules)?.nature).toBe('advance')
    expect(classify({ description: 'WOLT TLV', accountId: 'acc-company' }, rules)?.categoryId).toBe('cat-food')
  })

  it('כלל כבוי לא מסווג', () => {
    expect(classify({ description: 'BEZEQ' }, rules)).toBeNull()
  })

  it('לא מזוהה → null (→ unknown_expense + משימה בשכבה שמעל)', () => {
    expect(classify({ description: 'משהו לא מוכר' }, rules)).toBeNull()
  })

  it('מדד האוטומציה — יעד 80%/90%', () => {
    const batch = classifyBatch([
      { description: 'SUPER PHARM' }, { description: 'PAZ' }, { description: 'WOLT' }, { description: 'לא מוכר' },
    ], rules)
    expect(batch.autoRate).toBe(0.75)
    expect(batch.auto).toBe(3)
  })

  it('"להפוך לכלל?" — מסיר מספרים/תאריכים כדי לתפוס גם עסקאות עתידיות', () => {
    const p = proposeRule({ description: 'SUPER PHARM 1234 12/09', accountId: 'acc-1' }, { categoryId: 'cat-office', txClass: 'business' })
    expect(p.pattern).toBe('SUPER PHARM')
    expect(p.setCategoryId).toBe('cat-office')
    expect(p.accountId).toBeNull()
    expect(proposeRule({ description: 'WOLT', accountId: 'acc-1' }, {}, { scopeToAccount: true }).accountId).toBe('acc-1')
  })

  it('כללים סותרים מזוהים', () => {
    const conflicts = findConflicts([
      rule({ id: 'a', pattern: 'wolt', setCategoryId: 'x' }),
      rule({ id: 'b', pattern: 'WOLT ', setCategoryId: 'y' }),
    ])
    expect(conflicts).toHaveLength(1)
  })

  it('regex שבור לא מפיל את הסיווג', () => {
    expect(classify({ description: 'x' }, [rule({ id: 'bad', pattern: '(', isRegex: true })])).toBeNull()
  })
})
