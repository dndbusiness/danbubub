/**
 * חשבון כספים — SPEC §11.5: "סכומים: NUMERIC(14,2). לעולם לא float."
 *
 * ב-TypeScript אין NUMERIC, ולכן כל חישוב כאן עובר דרך *אגורות שלמות*.
 * החוצה מחזירים תמיד שקלים מעוגלים לשתי ספרות — אותו ערך שיישמר ב-DB.
 *
 * כל פונקציה במודול הזה טהורה. אין תאריך "עכשיו", אין Math.random, אין I/O.
 */

/** סכום בשקלים, תמיד מעוגל לשתי ספרות אחרי הנקודה. חתום: חיובי נכנס, שלילי יוצא. */
export type Shekels = number

/** סכום באגורות — מספר שלם. יחידת החישוב הפנימית. */
export type Agorot = number

const AGOROT_MAX = Number.MAX_SAFE_INTEGER

/** שקלים → אגורות שלמות. */
export function toAgorot(value: Shekels): Agorot {
  if (!Number.isFinite(value)) {
    throw new RangeError(`toAgorot: ערך לא חוקי ${value}`)
  }
  // Math.round מעגל −0.5 כלפי מעלה (ל-0), ולכן מעגלים את הערך המוחלט
  // ומחזירים את הסימן — כך 1.005 ו-(−1.005) מתעגלים סימטרית.
  const sign = value < 0 ? -1 : 1
  const agorot = sign * Math.round(Math.abs(value) * 100)
  if (Math.abs(agorot) > AGOROT_MAX) {
    throw new RangeError(`toAgorot: חריגה מטווח בטוח ${value}`)
  }
  return agorot
}

/** אגורות → שקלים. */
export function fromAgorot(value: Agorot): Shekels {
  return value / 100
}

/** עיגול לשתי ספרות, סימטרי סביב האפס. */
export function round2(value: Shekels): Shekels {
  return fromAgorot(toAgorot(value))
}

/** חיבור בטוח: עובר דרך אגורות, כך ש-0.1+0.2 מחזיר 0.3 ולא 0.30000000000000004. */
export function addMoney(...values: Shekels[]): Shekels {
  return fromAgorot(values.reduce<Agorot>((acc, v) => acc + toAgorot(v), 0))
}

/** חיסור בטוח: a − b − c … */
export function subMoney(from: Shekels, ...values: Shekels[]): Shekels {
  return fromAgorot(values.reduce<Agorot>((acc, v) => acc - toAgorot(v), toAgorot(from)))
}

/** סכימת רשימה. הבסיס לכל ה-Σ שבסעיף 3 של האפיון. */
export function sumMoney(values: readonly Shekels[]): Shekels {
  return fromAgorot(values.reduce<Agorot>((acc, v) => acc + toAgorot(v), 0))
}

/** סכימת רשימה לפי בורר — sumBy(txs, t => t.amountNet). */
export function sumBy<T>(items: readonly T[], select: (item: T) => Shekels): Shekels {
  return fromAgorot(items.reduce<Agorot>((acc, item) => acc + toAgorot(select(item)), 0))
}

/**
 * כפל סכום במקדם (אחוז חלוקה, שיעור מע"מ, הסתברות).
 * מעגל פעם אחת, בסוף — ולכן mulMoney(100, 1/3) הוא 33.33 ולא 33.3333…
 */
export function mulMoney(value: Shekels, factor: number): Shekels {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`mulMoney: מקדם לא חוקי ${factor}`)
  }
  const agorot = toAgorot(value) * factor
  const sign = agorot < 0 ? -1 : 1
  return fromAgorot(sign * Math.round(Math.abs(agorot)))
}

/** חילוק סכום במחלק. */
export function divMoney(value: Shekels, divisor: number): Shekels {
  if (!Number.isFinite(divisor) || divisor === 0) {
    throw new RangeError(`divMoney: מחלק לא חוקי ${divisor}`)
  }
  return mulMoney(value, 1 / divisor)
}

/** ערך מוחלט. */
export function absMoney(value: Shekels): Shekels {
  return fromAgorot(Math.abs(toAgorot(value)))
}

/** max(0, value) — משמש בשורה 8 של כרטיס ניסים. */
export function positivePart(value: Shekels): Shekels {
  return toAgorot(value) > 0 ? round2(value) : 0
}

/** השוואה מדויקת בין סכומים (אחרי עיגול לאגורה). */
export function moneyEquals(a: Shekels, b: Shekels): boolean {
  return toAgorot(a) === toAgorot(b)
}

/**
 * חלוקת סכום למספר מנות לפי משקלים, בלי לאבד אגורה.
 * השארית מתחלקת בשיטת הכי-גדול-שארית (largest remainder), כך ש-Σ המנות = הסכום המקורי בדיוק.
 * זה מה שמונע את הבעיה הקלאסית של 33.3%/33.3%/33.3% שמסתכמים ל-99.99.
 */
export function allocateMoney(value: Shekels, weights: readonly number[]): Shekels[] {
  if (weights.length === 0) return []
  const totalWeight = weights.reduce((a, w) => a + w, 0)
  if (totalWeight <= 0) {
    throw new RangeError('allocateMoney: סכום המשקלים חייב להיות חיובי')
  }
  const total = toAgorot(value)
  const sign = total < 0 ? -1 : 1
  const magnitude = Math.abs(total)

  const exact = weights.map((w) => (magnitude * w) / totalWeight)
  const floors = exact.map((e) => Math.floor(e))
  let remainder = magnitude - floors.reduce((a, f) => a + f, 0)

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  const result = [...floors]
  for (const { i } of order) {
    if (remainder <= 0) break
    result[i] = (result[i] ?? 0) + 1
    remainder -= 1
  }
  return result.map((a) => fromAgorot(sign * a))
}

/** פורמט תצוגה: 1,234.50 ₪ — SPEC §5.1 "₪ עם פסיקי אלפים בכל מקום". */
export function formatShekels(value: Shekels, opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? 2
  const rounded = round2(value)
  const formatted = new Intl.NumberFormat('he-IL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rounded)
  return `${formatted} ₪`
}
