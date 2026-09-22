import { describe, expect, it } from 'vitest'
import { buildCollectionReminder, reminderTone, toInternationalPhone } from '@/lib/rules/reminders.js'

const base = { clientName: 'כהן', amount: 45_000, dueDate: '2026-08-01', daysOverdue: 48, bucket: '31-60' as const }

describe('תזכורת גביה — ADDENDUM ב.6', () => {
  it('הטון מתחמם לפי הגיול', () => {
    expect(reminderTone('0-30')).toBe('friendly')
    expect(reminderTone('31-60')).toBe('firm')
    expect(reminderTone('61-90')).toBe('escalated')
    expect(reminderTone('90+')).toBe('escalated')
  })

  it('ההודעה מכילה שם, סכום מעוצב, תאריך יעד וימי איחור', () => {
    const m = buildCollectionReminder(base)
    expect(m.whatsapp).toContain('כהן')
    expect(m.whatsapp).toContain('45,000 ₪')
    expect(m.whatsapp).toContain('01/08/2026')
    expect(m.whatsapp).toContain('48 יום')
    expect(m.subject).toContain('45,000 ₪')
    expect(m.tone).toBe('firm')
  })

  it('הניסוח משתנה אם כבר הוצאה חשבונית', () => {
    expect(buildCollectionReminder({ ...base, invoiceIssued: true }).whatsapp).toContain('כבר נשלחה')
    expect(buildCollectionReminder({ ...base, invoiceIssued: false }).whatsapp).toContain('תישלח עם התשלום')
  })

  it('גיול 90+ מבקש עדכון, אבל לא מאיים', () => {
    const m = buildCollectionReminder({ ...base, bucket: '90+', daysOverdue: 120 })
    expect(m.whatsapp).toContain('עד סוף השבוע')
    expect(m.whatsapp).not.toMatch(/משפטי|עורך דין|תביעה/)
  })

  it('כל הודעה מסתיימת בחתימה ומאפשרת "כבר שילמתי"', () => {
    const m = buildCollectionReminder(base)
    expect(m.whatsapp.trimEnd().endsWith('הר-אל פתרונות מימון עסקי')).toBe(true)
    expect(m.whatsapp).toContain('אם כבר שילמתם')
    expect(m.emailHtml).toContain('dir="rtl"')
  })

  it('טלפון ישראלי → בינלאומי', () => {
    expect(toInternationalPhone('050-123-4567')).toBe('972501234567')
    expect(toInternationalPhone('972501234567')).toBe('972501234567')
    expect(toInternationalPhone('501234567')).toBe('972501234567')
    expect(toInternationalPhone('123')).toBeNull()
    expect(toInternationalPhone(null)).toBeNull()
  })
})
