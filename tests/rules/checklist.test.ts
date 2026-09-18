import { describe, expect, it } from 'vitest'
import {
  applyAutoMarks,
  computeChecklistProgress,
  computeExecutionPipeline,
  DEFAULT_CHECKLIST_TEMPLATES,
  findStuckChecklistItems,
  instantiateChecklist,
  templateFor,
  type ChecklistItem,
} from '@/lib/rules/checklist.js'

const ASOF = '2026-09-18'

function mark(items: ChecklistItem[], label: string, status: ChecklistItem['status'], since?: string) {
  return items.map((i) => (i.label === label ? { ...i, status, statusSince: since } : i))
}

describe('תבניות צ\'קליסט — ADDENDUM ב.5', () => {
  it('תבנית לכל מוצר', () => {
    for (const product of ['business_credit', 'mortgage_declined', 'vehicle_lien', 'presale']) {
      expect(templateFor(product)).toBeDefined()
    }
  })

  it('שעבוד רכב: 8 פריטים, בלי שמאות ובלי עו"ד', () => {
    const t = templateFor('vehicle_lien')!
    expect(t.items).toHaveLength(8)
    expect(t.items.map((i) => i.label)).not.toContain('שמאות בוצעה')
  })

  it('נדל"ן פריסייל מסתיים באישור ניכוי במקור', () => {
    const t = templateFor('presale')!
    expect(t.items.at(-1)!.label).toBe('אישור ניכוי במקור התקבל')
  })

  it('מוצר לא מוכר מחזיר רשימה ריקה ולא נופל', () => {
    expect(templateFor('unknown')).toBeUndefined()
    expect(instantiateChecklist('d1', 'unknown')).toEqual([])
  })

  it('יצירת צ\'קליסט לתיק — כל הפריטים pending', () => {
    const items = instantiateChecklist('d1', 'vehicle_lien')
    expect(items).toHaveLength(8)
    expect(items.every((i) => i.status === 'pending')).toBe(true)
    expect(items[0]!.sortOrder).toBe(1)
  })
})

describe('הפריט הבא שחסר — ADDENDUM ב.5', () => {
  it('הפריט הראשון שאינו done', () => {
    let items = instantiateChecklist('d1', 'vehicle_lien')
    items = mark(items, 'הסכם חתום', 'done')
    items = mark(items, 'מסמכי רכב + רישיון', 'done')
    const p = computeChecklistProgress('d1', items, ASOF)
    expect(p.nextMissing!.label).toBe('הוגש')
    expect(p.done).toBe(2)
  })

  it('פריט חסום הוא "הבא" — הוא מה שמעכב', () => {
    let items = instantiateChecklist('d1', 'vehicle_lien')
    items = mark(items, 'הסכם חתום', 'done')
    items = items.map((i) =>
      i.label === 'מסמכי רכב + רישיון'
        ? { ...i, status: 'blocked' as const, blockedReason: 'הלקוח לא שלח רישיון' }
        : i,
    )
    const p = computeChecklistProgress('d1', items, ASOF)
    expect(p.nextMissing!.label).toBe('מסמכי רכב + רישיון')
    expect(p.blocked).toHaveLength(1)
    expect(p.blocked[0]!.blockedReason).toBe('הלקוח לא שלח רישיון')
  })

  it('n/a לא חוסם ולא נספר במכנה', () => {
    let items = instantiateChecklist('d1', 'business_credit')
    items = items.map((i) => (i.label === 'שמאות בוצעה' ? { ...i, status: 'n/a' as const } : i))
    const p = computeChecklistProgress('d1', items, ASOF)
    expect(p.applicable).toBe(10) // 11 − 1
    expect(p.nextMissing!.label).not.toBe('שמאות בוצעה')
  })

  it('צ\'קליסט מלא = הושלם', () => {
    const items = instantiateChecklist('d1', 'vehicle_lien').map((i) => ({
      ...i, status: 'done' as const,
    }))
    const p = computeChecklistProgress('d1', items, ASOF)
    expect(p.isComplete).toBe(true)
    expect(p.nextMissing).toBeNull()
    expect(p.completionPct).toBe(100)
  })

  it('כמה ימים הפריט תקוע', () => {
    let items = instantiateChecklist('d1', 'vehicle_lien')
    items = mark(items, 'הסכם חתום', 'pending', '2026-09-01')
    expect(computeChecklistProgress('d1', items, ASOF).stuckDays).toBe(17)
  })

  it('בלי תאריך אין ימים תקועים — null ולא 0', () => {
    const items = instantiateChecklist('d1', 'vehicle_lien')
    expect(computeChecklistProgress('d1', items, ASOF).stuckDays).toBeNull()
  })
})

describe('סימון אוטומטי מ-WISE — ADDENDUM ב.5', () => {
  it('שינוי שלב ב-WISE מסמן את הפריט', () => {
    const items = instantiateChecklist('d1', 'business_credit')
    const changed = applyAutoMarks(items, [
      { label: 'הוגש לגוף מממן', source: 'wise', date: '2026-09-10' },
    ])
    expect(changed).toHaveLength(1)
    expect(changed[0]!.status).toBe('done')
    expect(changed[0]!.autoSource).toBe('wise')
  })

  it('פריט שכבר done לא מסומן שוב', () => {
    let items = instantiateChecklist('d1', 'business_credit')
    items = mark(items, 'הוגש לגוף מממן', 'done')
    expect(applyAutoMarks(items, [
      { label: 'הוגש לגוף מממן', source: 'wise', date: '2026-09-10' },
    ])).toHaveLength(0)
  })
})

describe('רמת החברה: לביצוע וגביה — ADDENDUM ב.5', () => {
  const deals = [
    { id: 'd1', clientName: 'כהן', product: 'business_credit', ownerUserId: 'u1' },
    { id: 'd2', clientName: 'לוי', product: 'business_credit', ownerUserId: 'u1' },
    { id: 'd3', clientName: 'מזרחי', product: 'vehicle_lien' },
  ]
  const amounts = new Map([['d1', 240_000], ['d2', 120_000], ['d3', 35_000]])

  let items: ChecklistItem[] = [
    ...instantiateChecklist('d1', 'business_credit'),
    ...instantiateChecklist('d2', 'business_credit'),
    ...instantiateChecklist('d3', 'vehicle_lien'),
  ]
  // d1 ו-d2 תקועים על מסמכי לקוח; d3 על הגשה
  items = items.map((i) => {
    if (i.dealId !== 'd3' && ['הסכם חתום', 'מקדמה התקבלה'].includes(i.label)) {
      return { ...i, status: 'done' as const }
    }
    if (i.dealId === 'd3' && ['הסכם חתום', 'מסמכי רכב + רישיון'].includes(i.label)) {
      return { ...i, status: 'done' as const }
    }
    return i
  })

  const summary = computeExecutionPipeline(deals, amounts, items, ASOF)

  it('ממוין לפי הסכום התקוע', () => {
    expect(summary.rows.map((r) => r.dealId)).toEqual(['d1', 'd2', 'd3'])
  })

  it('סה"כ תקוע', () => {
    expect(summary.totalAtStake).toBe(395_000)
  })

  it('פילוח לפי הפריט החוסם — "60% מחכים למסמכי לקוח"', () => {
    const docs = summary.byBlocker.find((b) => b.label === 'מסמכי לקוח מלאים')!
    expect(docs.count).toBe(2)
    expect(docs.amount).toBe(360_000)
    expect(docs.pctOfTotal).toBeCloseTo(91.14, 1)
  })

  it('תיק שהושלם אינו ברשימה', () => {
    const done = items.map((i) => (i.dealId === 'd3' ? { ...i, status: 'done' as const } : i))
    const s = computeExecutionPipeline(deals, amounts, done, ASOF)
    expect(s.rows.map((r) => r.dealId)).not.toContain('d3')
  })
})

describe('פריט תקוע 7 ימים — ADDENDUM ב.10', () => {
  it('מזוהה ליצירת משימה', () => {
    let items = instantiateChecklist('d1', 'vehicle_lien')
    items = mark(items, 'הסכם חתום', 'pending', '2026-09-05')
    const stuck = findStuckChecklistItems([{ id: 'd1', clientName: 'כהן' }], items, ASOF)
    expect(stuck).toHaveLength(1)
    expect(stuck[0]!.days).toBe(13)
  })

  it('מתחת לסף לא מזוהה', () => {
    let items = instantiateChecklist('d1', 'vehicle_lien')
    items = mark(items, 'הסכם חתום', 'pending', '2026-09-15')
    expect(findStuckChecklistItems([{ id: 'd1', clientName: 'כהן' }], items, ASOF)).toHaveLength(0)
  })
})
