import { sql } from '@/lib/db'
import { crmMode, writeDoc } from '@/lib/crm/store'
import { crmSettings } from '@/lib/crm/auth'
import { ATT, attNotifyCheck, attOutboxRows, attTz, attWatchPlan, type AttDoc, type AttKind, type AttSettings } from '@/lib/crm/attendance'
import { enqueueOutbox, flushOutbox } from './outbox'
import { runJob } from './run'

/**
 * שעון נוכחות בצד השרת (בקשת דן 17/10/26). דפדפן לא בודק מיקום כשהמערכת סגורה — לכן כל 15 דקות:
 *   (א) יצא מהטווח, לא אושר תוך 15 דקות → יציאה אוטומטית בשעת היציאה;
 *   (ב) שעה בלי פעילות → התראה אחת למנהל (אותו rule_key כמו בדף) והפער נרשם;
 *   (ג) אחרי 23:00 / יום קודם → משמרת פתוחה נסגרת בפעילות האחרונה.
 * הכתיבה דרך writeDoc — כך הדפים הפתוחים מקבלים את השינוי בסנכרון הבא.
 *
 * הנחיה 14: הג'וב לא מופיע בחלק ג' המקורי — סטייה שדן אישר (17/10/26), כמו crm_mirror.
 */

const baseUrl = () => process.env.APP_BASE_URL ?? ''

/** משמרות פתוחות מהימים האחרונים (ישנות יותר נשארות כמו שהן — הדוח כבר מחשב אותן לפי הפעילות האחרונה) */
async function openShifts(now: number): Promise<{ id: string; data: AttDoc }[]> {
  const from = attTz(now - ATT.lookbackDays * 86400e3).date
  return sql<{ id: string; data: AttDoc }[]>`
    select doc_id as id, data from crm_docs
    where coll = 'attendance' and deleted_at is null and data ? 'in'
      and (data->'out' is null or jsonb_typeof(data->'out') = 'null')
      and data->>'date' >= ${from}
    order by doc_id`
}

export async function attendanceWatchJob(_asOf: string, opts: { now?: number } = {}) {
  return runJob('attendance_watch', async () => {
    if ((await crmMode()) !== 'live') return { rowsTouched: 0, skipped: 'מצב שכפול — הדף ב-Claude הוא המקור, השרת לא נוגע בנוכחות' }
    const now = opts.now ?? Date.now()
    const [docs, settings] = await Promise.all([openShifts(now), crmSettings() as Promise<AttSettings>])
    // notified לא חוסם כאן: ה-dedup_key ב-outbox מונע כפילות, וכך התראה שהדף סימן ולא הצליח לשלוח עדיין יוצאת
    const plan = attWatchPlan(docs.map((d) => ({ id: d.id, data: { ...d.data, notified: [] } })), settings, now, baseUrl())
    let queued = 0, written = 0
    const detail = { open: docs.length, autoOut: 0, endOfDay: 0, idleAlerts: 0, awayAlerts: 0, queued: 0, items: [] as { id: string; why: string }[] }
    for (const it of plan) {
      const cur = docs.find((d) => d.id === it.id)!.data
      queued += await enqueueOutbox(it.rows)
      const patch = { ...(it.patch ?? {}) }
      patch.notified = [...new Set([...(cur.notified ?? []), ...it.notify.map((n) => n.ruleKey)])]
      const changed = Object.entries(patch).some(([k, v]) => JSON.stringify((cur as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify(v ?? null))
      if (changed) { await writeDoc('attendance/' + it.id, 'update', patch); written++ }
      if (it.why === 'away' || it.why === 'rejected') detail.autoOut++
      if (it.why === 'eod') detail.endOfDay++
      detail.idleAlerts += it.notify.filter((n) => n.kind === 'idle').length
      detail.awayAlerts += it.notify.filter((n) => n.kind === 'away').length
      detail.items.push({ id: it.id, why: it.why })
    }
    detail.queued = queued
    const flush = queued ? await flushOutbox() : null
    return { rowsTouched: written + queued, detail: { ...detail, flush } }
  })
}

/**
 * הדף מבקש התראה (POST /api/crm/attendance/notify). השרת קורא את המסמך בעצמו ומחליט אם היא מוצדקת —
 * הדפדפן לא קובע את הנוסח, את הנמען או את ה-rule_key.
 */
export async function attendanceNotify(key: string, date: string, kind: AttKind, now = Date.now()) {
  const [r] = await sql<{ data: AttDoc }[]>`select data from crm_docs where coll = 'attendance' and doc_id = ${key + '_' + date} and deleted_at is null`
  const a = r?.data ? { ...r.data, key: r.data.key ?? key, date: r.data.date ?? date } : null
  const n = attNotifyCheck(a, kind, now)
  if (!a || !n) return { ok: false as const, reason: 'המצב במסמך לא מצדיק התראה' }
  const { manager, rows } = attOutboxRows(n, a, (await crmSettings()) as AttSettings, baseUrl())
  const queued = await enqueueOutbox(rows)
  if (queued) await flushOutbox().catch((e) => console.error('outbox:', (e as Error).message))
  return { ok: true as const, ruleKey: n.ruleKey, manager, channels: rows.map((x) => x.channel), queued }
}
