/**
 * מהתראה להודעה — ADDENDUM ב.11 (ערוצים) + הנחיה 16 (הכול דרך outbox).
 *
 * טהור: מקבל התראה ויעדי מסירה, מחזיר את שורות ה-outbox שצריך לכתוב.
 * ערוצי "במסך" / "סיכום יומי" / "דוח שבועי" אינם הודעות מיידיות — הם נאספים
 * ע"י ב.4 / ב.7 ולא מייצרים שורה כאן.
 */

import type { Alert } from './alerts.js'
import type { IsoDate } from './period.js'

export interface DeliveryTargets {
  /** מספר וואטסאפ בפורמט בינלאומי בלי + (Green-API chatId ללא @c.us). */
  whatsapp?: string | null
  email?: string | null
}

export interface OutboxRow {
  channel: 'whatsapp' | 'email' | 'calendar'
  target: string
  subject: string | null
  body: string
  dedupKey: string
}

const SEVERITY_LABEL: Record<Alert['severity'], string> = { critical: 'קריטי', high: 'גבוה', info: 'מידע' }

export function formatAlertMessage(alert: Alert, baseUrl = ''): string {
  const lines = [`⚠ ${alert.title}`]
  if (alert.detail) lines.push(alert.detail)
  if (alert.amount !== undefined) lines.push(`סכום: ${Math.round(alert.amount).toLocaleString('he-IL')} ₪`)
  if (alert.date) lines.push(`תאריך: ${alert.date}`)
  lines.push(`חומרה: ${SEVERITY_LABEL[alert.severity]}`)
  if (baseUrl) lines.push(`${baseUrl}/alerts`)
  return lines.join('\n')
}

/**
 * שורות outbox להתראה חדשה. dedup_key מונע שליחה כפולה של אותה התראה באותו ערוץ
 * (הנחיה 18 — rule_key ייחודי, גם במסירה).
 */
export function outboxRowsForAlert(alert: Alert, targets: DeliveryTargets, baseUrl = ''): OutboxRow[] {
  const body = formatAlertMessage(alert, baseUrl)
  const rows: OutboxRow[] = []
  for (const ch of alert.channels) {
    if (ch !== 'whatsapp' && ch !== 'email') continue
    const target = ch === 'whatsapp' ? targets.whatsapp : targets.email
    if (!target) continue
    rows.push({ channel: ch, target, subject: ch === 'email' ? `הר-אל · ${alert.title}` : null, body, dedupKey: `alert:${alert.ruleKey}:${ch}` })
  }
  return rows
}

/** חלק ג' `anchor_reminder` — "08:30 יומי אם אין עוגן". הודעת וואטסאפ אחת ליום. */
export function anchorReminderRow(asOf: IsoDate, lastAnchorDate: IsoDate | null, targets: DeliveryTargets, baseUrl = ''): OutboxRow | null {
  if (!targets.whatsapp) return null
  if (lastAnchorDate === asOf) return null
  const since = lastAnchorDate ? `העוגן האחרון: ${lastAnchorDate}.` : 'עדיין לא הוזן עוגן.'
  return {
    channel: 'whatsapp', target: targets.whatsapp, subject: null,
    body: `בוקר טוב 👋 מה היתרה בבנק היום? ${since}${baseUrl ? `\n${baseUrl}/anchor` : ''}`,
    dedupKey: `anchor_reminder:${asOf}`,
  }
}

/** retry עם backoff: 1, 5, 15, 60, 240 דקות. */
export function nextAttemptDelayMinutes(attempts: number): number {
  const steps = [1, 5, 15, 60, 240]
  return steps[Math.min(attempts, steps.length - 1)]!
}
