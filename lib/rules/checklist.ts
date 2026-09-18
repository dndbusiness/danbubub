/**
 * "מה צריך כדי לבצע ולקבל כסף" — ADDENDUM ב.5.
 *
 * לכל תיק רשימת תנאים שחייבים להתקיים כדי שהכסף ייכנס. הרשימה נולדת מתבנית
 * לפי מוצר וניתנת לעריכה בתיק.
 *
 * השאלה שהמודול הזה עונה עליה היא לא "מה הסטטוס" אלא **"מה הפריט הבא שחסר"** —
 * ברמת תיק ("מחכה למסמכי לקוח") וברמת החברה ("395K תקועים; 60% מהם מחכים
 * למסמכי לקוח").
 */

import { round2, sumBy, type Shekels } from './money.js'
import { daysBetween, type IsoDate } from './period.js'

export type ChecklistItemStatus = 'done' | 'pending' | 'blocked' | 'n/a'

/** ADDENDUM ב.5 — כל פריט: סטטוס, תאריך, מי סימן, קישור למסמך. */
export interface ChecklistItem {
  id: string
  dealId: string
  /** מיקום בתבנית — קובע מה "הבא". */
  sortOrder: number
  label: string
  status: ChecklistItemStatus
  /** ל-`blocked` — הסיבה. */
  blockedReason?: string
  /** מתי הפריט קיבל את הסטטוס הנוכחי. */
  statusSince?: IsoDate
  markedBy?: string
  documentId?: string
  /** הפריט מסומן אוטומטית משינוי שלב ב-WISE (§4.5). */
  autoSource?: 'wise' | 'invoice' | 'transaction'
}

export interface ChecklistTemplate {
  product: string
  items: Array<{ label: string; sortOrder: number }>
  /**
   * ADDENDUM v2 ב.5, החלטה 3 — תבנית שקיימת "לעתיד" אך אינה בשימוש עכשיו.
   * תיק במוצר כזה לא מקבל צ'קליסט אוטומטית.
   */
  enabled: boolean
}

/** ADDENDUM ב.5 — תבניות ברירת מחדל, ניתנות לעריכה בהגדרות. */
export const DEFAULT_CHECKLIST_TEMPLATES: readonly ChecklistTemplate[] = [
  {
    product: 'business_credit',
    enabled: true,
    items: [
      'הסכם חתום',
      'מקדמה התקבלה',
      'מסמכי לקוח מלאים',
      'הוגש לגוף מממן',
      'אישור עקרוני',
      'שמאות בוצעה',
      'חתימה אצל עו"ד',
      'ביצוע — הכסף עבר ללקוח',
      'חשבונית שכ"ט הוצאה',
      'שכ"ט נגבה',
      'קבלה הוצאה',
    ].map((label, i) => ({ label, sortOrder: i + 1 })),
  },
  {
    product: 'mortgage_declined',
    enabled: true,
    items: [
      'הסכם חתום',
      'מקדמה התקבלה',
      'מסמכי לקוח מלאים',
      'הוגש לגוף מממן',
      'אישור עקרוני',
      'שמאות בוצעה',
      'חתימה אצל עו"ד',
      'ביצוע — הכסף עבר ללקוח',
      'חשבונית שכ"ט הוצאה',
      'שכ"ט נגבה',
      'קבלה הוצאה',
    ].map((label, i) => ({ label, sortOrder: i + 1 })),
  },
  {
    product: 'vehicle_lien',
    enabled: true,
    items: [
      'הסכם חתום',
      'מסמכי רכב + רישיון',
      'הוגש',
      'אושר',
      'ביצוע',
      'חשבונית',
      'נגבה',
      'קבלה',
    ].map((label, i) => ({ label, sortOrder: i + 1 })),
  },
  {
    // ADDENDUM v2 ב.5 — "לא בשלב זה (החלטה 3); תבנית לעתיד".
    product: 'presale',
    enabled: false,
    items: [
      'הסכם תיווך חתום',
      'חוזה דירה נחתם',
      'חשבונית עמלת אחוזים + דמי פתיחה',
      'נגבה',
      'דיווח ליזם',
      'חשבונית ליזם',
      'עמלת יזם התקבלה',
      'אישור ניכוי במקור התקבל',
    ].map((label, i) => ({ label, sortOrder: i + 1 })),
  },
]

export function templateFor(
  product: string,
  templates: readonly ChecklistTemplate[] = DEFAULT_CHECKLIST_TEMPLATES,
): ChecklistTemplate | undefined {
  return templates.find((t) => t.product === product)
}

/**
 * יוצר את פריטי הצ'קליסט לתיק חדש מתוך התבנית.
 * תבנית לא פעילה (החלטה 3) מחזירה רשימה ריקה, אלא אם `includeDisabled`.
 */
export function instantiateChecklist(
  dealId: string,
  product: string,
  templates: readonly ChecklistTemplate[] = DEFAULT_CHECKLIST_TEMPLATES,
  opts: { includeDisabled?: boolean } = {},
): ChecklistItem[] {
  const template = templateFor(product, templates)
  if (!template) return []
  if (!template.enabled && !opts.includeDisabled) return []
  return template.items.map((item) => ({
    id: `${dealId}:${item.sortOrder}`,
    dealId,
    sortOrder: item.sortOrder,
    label: item.label,
    status: 'pending' as const,
  }))
}

export interface ChecklistProgress {
  dealId: string
  total: number
  done: number
  /** `n/a` לא נספר במכנה — פריט שלא רלוונטי לתיק אינו חוסם. */
  applicable: number
  completionPct: number
  /** הפריט הבא שחסר — הדבר היחיד שצריך לעשות עכשיו. */
  nextMissing: ChecklistItem | null
  /** פריטים חסומים, עם הסיבה. */
  blocked: ChecklistItem[]
  /** כמה ימים הפריט הבא תקוע. null אם אין תאריך או אין פריט. */
  stuckDays: number | null
  isComplete: boolean
}

/**
 * הפריט הבא שחסר = הפריט הראשון בסדר התבנית שאינו `done` ואינו `n/a`.
 * פריט חסום נחשב "הבא" — הוא מה שמעכב, גם אם אחריו יש pending.
 */
export function computeChecklistProgress(
  dealId: string,
  items: readonly ChecklistItem[],
  asOf: IsoDate,
): ChecklistProgress {
  const mine = items
    .filter((i) => i.dealId === dealId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const applicable = mine.filter((i) => i.status !== 'n/a')
  const done = applicable.filter((i) => i.status === 'done')
  const nextMissing = applicable.find((i) => i.status !== 'done') ?? null

  return {
    dealId,
    total: mine.length,
    done: done.length,
    applicable: applicable.length,
    completionPct: applicable.length
      ? round2((done.length / applicable.length) * 100)
      : 0,
    nextMissing,
    blocked: mine.filter((i) => i.status === 'blocked'),
    stuckDays:
      nextMissing?.statusSince !== undefined
        ? daysBetween(nextMissing.statusSince, asOf)
        : null,
    isComplete: applicable.length > 0 && nextMissing === null,
  }
}

/**
 * ADDENDUM ב.5 — סימון אוטומטי משינוי שלב ב-WISE.
 * מחזיר את הפריטים שהשתנו, ולא משנה במקום: המחיקה/הכתיבה שייכת לשכבה שמעליה.
 */
export function applyAutoMarks(
  items: readonly ChecklistItem[],
  marks: readonly { label: string; source: NonNullable<ChecklistItem['autoSource']>; date: IsoDate }[],
): ChecklistItem[] {
  const byLabel = new Map(marks.map((m) => [m.label, m]))
  return items
    .filter((item) => item.status !== 'done' && byLabel.has(item.label))
    .map((item) => {
      const mark = byLabel.get(item.label)!
      return {
        ...item,
        status: 'done' as const,
        statusSince: mark.date,
        autoSource: mark.source,
      }
    })
}

// ── רמת החברה: "לביצוע וגביה" (ADDENDUM ב.5, מסך 4 טאב) ────────────────────

export interface ExecutionPipelineRow {
  dealId: string
  clientName: string
  /** הסכום שיתקבל בסיום. */
  amountAtStake: Shekels
  nextMissing: string | null
  blockedReason?: string
  ownerUserId?: string
  stuckDays: number | null
  completionPct: number
}

export interface ExecutionPipelineSummary {
  rows: ExecutionPipelineRow[]
  /** סה"כ תקוע. */
  totalAtStake: Shekels
  /** פילוח לפי הפריט החוסם — "60% מהם מחכים למסמכי לקוח". */
  byBlocker: Array<{ label: string; amount: Shekels; count: number; pctOfTotal: number }>
}

export function computeExecutionPipeline(
  deals: readonly { id: string; clientName: string; product: string; ownerUserId?: string }[],
  openAmounts: ReadonlyMap<string, Shekels>,
  items: readonly ChecklistItem[],
  asOf: IsoDate,
): ExecutionPipelineSummary {
  const rows: ExecutionPipelineRow[] = []

  for (const deal of deals) {
    const progress = computeChecklistProgress(deal.id, items, asOf)
    if (progress.isComplete || progress.applicable === 0) continue

    const amount = openAmounts.get(deal.id) ?? 0
    rows.push({
      dealId: deal.id,
      clientName: deal.clientName,
      amountAtStake: amount,
      nextMissing: progress.nextMissing?.label ?? null,
      blockedReason: progress.nextMissing?.blockedReason,
      ownerUserId: deal.ownerUserId,
      stuckDays: progress.stuckDays,
      completionPct: progress.completionPct,
    })
  }

  rows.sort((a, b) => b.amountAtStake - a.amountAtStake)
  const totalAtStake = sumBy(rows, (r) => r.amountAtStake)

  const grouped = new Map<string, { amount: Shekels; count: number }>()
  for (const row of rows) {
    const key = row.nextMissing ?? 'לא ידוע'
    const current = grouped.get(key) ?? { amount: 0, count: 0 }
    grouped.set(key, { amount: current.amount + row.amountAtStake, count: current.count + 1 })
  }

  const byBlocker = [...grouped.entries()]
    .map(([label, g]) => ({
      label,
      amount: round2(g.amount),
      count: g.count,
      pctOfTotal: totalAtStake > 0 ? round2((g.amount / totalAtStake) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  return { rows, totalAtStake, byBlocker }
}

/** ADDENDUM ב.10 — פריט צ'קליסט תקוע 7 ימים יוצר משימה. */
export const CHECKLIST_STUCK_DAYS = 7

export function findStuckChecklistItems(
  deals: readonly { id: string; clientName: string }[],
  items: readonly ChecklistItem[],
  asOf: IsoDate,
  thresholdDays = CHECKLIST_STUCK_DAYS,
): Array<{ dealId: string; clientName: string; item: ChecklistItem; days: number }> {
  const out: Array<{ dealId: string; clientName: string; item: ChecklistItem; days: number }> = []
  for (const deal of deals) {
    const progress = computeChecklistProgress(deal.id, items, asOf)
    if (!progress.nextMissing || progress.stuckDays === null) continue
    if (progress.stuckDays >= thresholdDays) {
      out.push({
        dealId: deal.id,
        clientName: deal.clientName,
        item: progress.nextMissing,
        days: progress.stuckDays,
      })
    }
  }
  return out
}
