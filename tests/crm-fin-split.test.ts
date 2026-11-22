import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** חלוקת הר-אל פתרונות לפי חודש (דן 22/11) — אותו קוד שרץ במסך. נתונים סינתטיים. */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ חלוקת הר-אל פתרונות לפי חודש'), b = html.indexOf('/* ══ סוף חלוקת הר-אל פתרונות — פונקציות טהורות ══ */')
const F = new Function(html.slice(a, b) + '; return { finSplitAt, finSplitShare };')() as any
const L = [{ from: '2026-12', nissimPct: 1 / 3, exclude: ['אביב'] }], RE = ['יונס', 'אביב', 'דן']

describe('ניסים 33% מ-12/2026, בלי רטרו', () => {
  it('11/2026 — ההגדרה הקודמת; 12/2026 והלאה — שליש', () => {
    expect(F.finSplitAt(L, '2026-11')).toBeNull()
    expect(F.finSplitAt(L, '2026-12').nissimPct).toBeCloseTo(1 / 3)
    expect(F.finSplitAt(L, '2027-03').nissimPct).toBeCloseTo(1 / 3)
  })
  it('לפני: 50% לשלושת שותפי הנדל״ן (כמו קודם)', () => {
    expect(F.finSplitShare(30000, null, RE, 0.5, 0.5)).toEqual({ nissimPct: 0.5, who: null, group: 15000, each: 5000 })
  })
  it('אחרי: ניסים, דן ויונס — שליש כל אחד; אביב לא בחלוקה', () => {
    const r = F.finSplitShare(30000, F.finSplitAt(L, '2026-12'), RE, 0.5, 0.5)
    expect(r.who).toEqual(['יונס', 'דן']); expect(r.group).toBe(20000); expect(r.each).toBe(10000)
  })
  it('הפסד מתחלק באותה צורה', () => {
    expect(F.finSplitShare(-9000, F.finSplitAt(L, '2026-12'), RE, 0.5, 0.5).each).toBe(-3000)
  })
})
