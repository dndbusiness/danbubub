/**
 * תקופות — SPEC §1.6 ("תקופה נעולה לא משתנה") ו-§3.4 (שיוך עסקה לחודש).
 *
 * כל התאריכים במערכת הם מחרוזות ISO `YYYY-MM-DD` וכל החודשים `YYYY-MM`.
 * זה מכוון: השוואת מחרוזות היא גם השוואה כרונולוגית, אין אזורי זמן,
 * ואין `new Date()` שמכניס את "עכשיו" לתוך פונקציה טהורה.
 */

export type IsoDate = string // YYYY-MM-DD
export type IsoMonth = string // YYYY-MM

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

export function assertIsoDate(value: string): IsoDate {
  if (!DATE_RE.test(value)) throw new RangeError(`תאריך לא חוקי: ${value} (צפוי YYYY-MM-DD)`)
  return value
}

export function assertIsoMonth(value: string): IsoMonth {
  if (!MONTH_RE.test(value)) throw new RangeError(`חודש לא חוקי: ${value} (צפוי YYYY-MM)`)
  return value
}

export interface DateRange {
  from: IsoDate
  to: IsoDate
}

/** החודש שאליו שייך תאריך. */
export function monthOf(date: IsoDate): IsoMonth {
  return assertIsoDate(date).slice(0, 7)
}

/** טווח התאריכים של חודש שלם. */
export function monthRange(month: IsoMonth): DateRange {
  assertIsoMonth(month)
  const [y, m] = month.split('-').map(Number) as [number, number]
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

/** האם תאריך בתוך טווח (כולל שני הקצוות). */
export function inRange(date: IsoDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to
}

/** הזזת חודש קדימה/אחורה. addMonths('2026-09', -2) === '2026-07' */
export function addMonths(month: IsoMonth, delta: number): IsoMonth {
  assertIsoMonth(month)
  const [y, m] = month.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + delta
  const year = Math.floor(total / 12)
  const mon = (total % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}`
}

/** רשימת חודשים רצופה, כולל שני הקצוות. */
export function monthsBetween(from: IsoMonth, to: IsoMonth): IsoMonth[] {
  assertIsoMonth(from)
  assertIsoMonth(to)
  const out: IsoMonth[] = []
  let cursor = from
  // הגנה מפני טווח הפוך
  if (from > to) return out
  while (cursor <= to) {
    out.push(cursor)
    cursor = addMonths(cursor, 1)
  }
  return out
}

/** הזזת ימים. */
export function addDays(date: IsoDate, delta: number): IsoDate {
  assertIsoDate(date)
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** מספר ימים בין שני תאריכים (to − from). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  assertIsoDate(from)
  assertIsoDate(to)
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * תחילת השבוע (ראשון) שאליו שייך התאריך — SPEC §3.8 מודד לפי שבוע.
 * בישראל השבוע מתחיל ביום ראשון, ולכן getUTCDay()===0 הוא היום הראשון.
 */
export function weekStart(date: IsoDate): IsoDate {
  assertIsoDate(date)
  const d = new Date(`${date}T00:00:00Z`)
  return addDays(date, -d.getUTCDay())
}

/** מזהה שבוע לתצוגה ולקיבוץ: תאריך יום ראשון. */
export function weekKey(date: IsoDate): IsoDate {
  return weekStart(date)
}

/**
 * היום ה-N בחודש, מקוצץ לאורך החודש.
 * dayInMonth('2026-02', 30) === '2026-02-28' — הוצאה קבועה ליום 30 לא "נעלמת" בפברואר.
 */
export function dayInMonth(month: IsoMonth, day: number): IsoDate {
  const { to } = monthRange(month)
  const lastDay = Number(to.slice(8))
  const clamped = Math.min(Math.max(day, 1), lastDay)
  return `${month}-${String(clamped).padStart(2, '0')}`
}

/** SPEC §1.6 — תקופה נעולה. השאילתה הזו היא השכבה השנייה; הראשונה היא trigger ב-DB. */
export function isPeriodLocked(
  month: IsoMonth,
  division: 'realestate' | 'finance',
  periods: readonly { year: number; month: number; division: string; status: string }[],
): boolean {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return periods.some(
    (p) => p.year === y && p.month === m && p.division === division && p.status === 'closed',
  )
}
