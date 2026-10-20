import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { heNumWords } from '@/lib/rules/hebrew-number'

const CASES: [number, string][] = [
  [1, 'אחד'], [2, 'שניים'], [10, 'עשרה'], [12, 'שנים עשר'], [21, 'עשרים ואחד'], [100, 'מאה'], [105, 'מאה וחמישה'], [250, 'מאתיים וחמישים'],
  [999, 'תשע מאות תשעים ותשעה'], [1000, 'אלף'], [1500, 'אלף וחמש מאות'], [2000, 'אלפיים'], [2500, 'אלפיים וחמש מאות'], [3005, 'שלושת אלפים וחמישה'],
  [5974, 'חמשת אלפים תשע מאות שבעים וארבעה'], [10000, 'עשרת אלפים'], [11000, 'אחד עשר אלף'], [12500, 'שנים עשר אלף וחמש מאות'],
  [50000, 'חמישים אלף'], [125000, 'מאה עשרים וחמישה אלף'], [125300, 'מאה עשרים וחמישה אלף ושלוש מאות'], [125350, 'מאה עשרים וחמישה אלף שלוש מאות וחמישים'],
  [1000000, 'מיליון'], [1200000, 'מיליון ומאתיים אלף'], [1800000, 'מיליון ושמונה מאות אלף'], [2000000, 'שני מיליון'], [3450000, 'שלושה מיליון ארבע מאות וחמישים אלף'],
]
describe('סכום במילים', () => {
  it.each(CASES)('%d', (n, w) => expect(heNumWords(n)).toBe(w))
  it('מחרוזת עם פסיקים ו-₪', () => expect(heNumWords('50,000 ₪')).toBe('חמישים אלף'))
  it('הדף משתמש באותה פונקציה בדיוק', () => {
    const html = readFileSync('crm/harel-crm.html', 'utf8')
    const m = html.match(/\/\* heNumWords:start \*\/([\s\S]*?)\/\* heNumWords:end \*\//)
    expect(m).toBeTruthy()
    const page = new Function(m![1] + '\nreturn heNumWords;')() as (n: number) => string
    for (const [n, w] of CASES) expect(page(n)).toBe(w)
  })
})
