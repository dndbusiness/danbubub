import { describe, expect, it } from 'vitest'
import {
  addMoney,
  allocateMoney,
  divMoney,
  formatShekels,
  moneyEquals,
  mulMoney,
  positivePart,
  round2,
  subMoney,
  sumBy,
  sumMoney,
  toAgorot,
} from '@/lib/rules/money.js'

describe('חשבון כספים — SPEC §11.5 "לעולם לא float"', () => {
  it('חיבור לא צובר שגיאת float', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3)
    expect(0.1 + 0.2).not.toBe(0.3) // זו הסיבה שהמודול קיים
  })

  it('סכימה של אלף שורות נשארת מדויקת', () => {
    const rows = Array.from({ length: 1000 }, () => 0.01)
    expect(sumMoney(rows)).toBe(10)
  })

  it('חיסור שרשרת', () => {
    expect(subMoney(45_000, 61_262, 12_000)).toBe(-28_262)
  })

  it('עיגול סימטרי סביב האפס: round2(−x) === −round2(x)', () => {
    // 0.125 ניתן לייצוג מדויק ב-IEEE754, ולכן הוא בודק את העיגול ולא את הייצוג.
    expect(round2(0.125)).toBe(0.13)
    expect(round2(-0.125)).toBe(-0.13)
    // Math.round לבדו מעגל −0.5 כלפי מעלה ושובר את הסימטריה.
    expect(Math.round(-12.5) / 100).toBe(-0.12)
  })

  it('כפל מעגל פעם אחת בלבד', () => {
    expect(mulMoney(100, 1 / 3)).toBe(33.33)
    expect(mulMoney(20_327.5, 0.8)).toBe(16_262)
  })

  it('חלוקה', () => {
    expect(divMoney(100_067, 3)).toBe(33_355.67)
  })

  it('positivePart — שורה 8 בכרטיס ניסים', () => {
    expect(positivePart(1_234.5)).toBe(1_234.5)
    expect(positivePart(-1_234.5)).toBe(0)
    expect(positivePart(0)).toBe(0)
  })

  it('sumBy סוכם לפי בורר', () => {
    expect(sumBy([{ a: 1.1 }, { a: 2.2 }], (x) => x.a)).toBe(3.3)
  })

  it('moneyEquals משווה ברמת האגורה', () => {
    expect(moneyEquals(1.004, 1.0)).toBe(true)
    expect(moneyEquals(1.006, 1.0)).toBe(false)
  })

  it('ערך לא חוקי נופל מיד ולא מייצר NaN שקט', () => {
    expect(() => toAgorot(Number.NaN)).toThrow()
    expect(() => toAgorot(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe('חלוקה למנות בלי לאבד אגורה — SPEC §3.5 (33/33/33)', () => {
  it('שלוש מנות שוות מסתכמות בדיוק לסכום המקורי', () => {
    const parts = allocateMoney(100, [1, 1, 1])
    expect(parts).toEqual([33.34, 33.33, 33.33])
    expect(sumMoney(parts)).toBe(100)
  })

  it('סכום שלילי מתחלק גם הוא בלי איבוד', () => {
    const parts = allocateMoney(-28_262, [1, 1, 1])
    expect(sumMoney(parts)).toBe(-28_262)
  })

  it('משקלים לא שווים — 80/20', () => {
    const parts = allocateMoney(20_327.5, [0.8, 0.2])
    expect(parts).toEqual([16_262, 4_065.5])
    expect(sumMoney(parts)).toBe(20_327.5)
  })

  it('סכום אמיתי מהיעדים מתחלק לשלושה בלי שארית', () => {
    const parts = allocateMoney(100_067, [1, 1, 1])
    expect(sumMoney(parts)).toBe(100_067)
  })

  it('משקלים לא חוקיים נופלים', () => {
    expect(() => allocateMoney(100, [0, 0])).toThrow()
  })
})

describe('פורמט תצוגה — SPEC §5.1', () => {
  it('₪ עם פסיקי אלפים', () => {
    expect(formatShekels(1_234_567.5)).toBe('1,234,567.50 ₪')
  })

  it('ללא עשרוניות לכרטיסי ה-KPI', () => {
    expect(formatShekels(105_882, { decimals: 0 })).toBe('105,882 ₪')
  })
})
