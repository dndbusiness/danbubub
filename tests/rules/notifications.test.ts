import { describe, expect, it } from 'vitest'
import { anchorReminderRow, nextAttemptDelayMinutes, outboxRowsForAlert } from '@/lib/rules/notifications.js'
import type { Alert } from '@/lib/rules/alerts.js'

const alert: Alert = {
  kind: 'negative_balance_forecast', ruleKey: 'negative_balance:2026-10-04', severity: 'critical',
  channels: ['whatsapp', 'email'], title: 'יתרה צפויה שלילית ב-2026-10-04', amount: -8200, date: '2026-10-04',
}

describe('התראה → outbox (הנחיה 16, ב.11)', () => {
  it('שורה לכל ערוץ מיידי שיש לו יעד; dedup לפי rule_key + ערוץ', () => {
    const rows = outboxRowsForAlert(alert, { whatsapp: '972501234567', email: 'dan@example.com' }, 'https://x')
    expect(rows.map((r) => r.channel)).toEqual(['whatsapp', 'email'])
    expect(rows[0]!.dedupKey).toBe('alert:negative_balance:2026-10-04:whatsapp')
    expect(rows[0]!.body).toContain('יתרה צפויה שלילית')
    expect(rows[0]!.body).toContain('8,200')
    expect(rows[1]!.subject).toContain('הר-אל')
  })

  it('בלי יעד — אין שורה (ההתראה נשארת במסך)', () => {
    expect(outboxRowsForAlert(alert, {})).toEqual([])
    expect(outboxRowsForAlert(alert, { whatsapp: '972501234567' })).toHaveLength(1)
  })

  it('ערוצי מסך / סיכום יומי / דוח שבועי לא מייצרים הודעה מיידית', () => {
    const screenOnly: Alert = { ...alert, channels: ['screen', 'daily_summary', 'weekly_report'] }
    expect(outboxRowsForAlert(screenOnly, { whatsapp: '972501234567', email: 'a@b' })).toEqual([])
  })

  it('תזכורת עוגן: פעם ביום, רק אם אין עוגן היום', () => {
    expect(anchorReminderRow('2026-09-18', '2026-09-18', { whatsapp: '9725' })).toBeNull()
    expect(anchorReminderRow('2026-09-18', '2026-09-16', { whatsapp: '9725' })?.dedupKey).toBe('anchor_reminder:2026-09-18')
    expect(anchorReminderRow('2026-09-18', null, {})).toBeNull()
  })

  it('backoff עולה ונעצר ב-240 דקות', () => {
    expect([0, 1, 2, 3, 4, 9].map(nextAttemptDelayMinutes)).toEqual([1, 5, 15, 60, 240, 240])
  })
})
