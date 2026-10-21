/**
 * טפסי הגופים שהשדות שלהם הוצבו ונבדקו מראש (data/sign-forms/curated.json, דן 21/10:
 * "העליתי טפסים — לבנות תבניות שכבר אפשר לשלוח"). המפתח: SHA-256 של הקובץ.
 * הטקסט בחלק מהטפסים מקודד כך שזיהוי התוויות בדפדפן לא קורא אותו — לכן השדות כאן, לא בניחוש.
 */
import { readFileSync, statSync } from 'node:fs'
import data from '@/data/sign-forms/curated.json'
import { cleanField, signersNeeded, validatePdfFields, type PdfField } from '@/lib/rules/sign-pdf'
import { SIGN_CATEGORIES, type SignCategory } from '@/lib/rules/sign'
import { FORM_TYPES, type FormType } from '@/lib/rules/form-types'

export interface CuratedForm {
  sha256: string; name: string; folder: string; type: FormType; category: SignCategory; pages: number; signers: number; fields: PdfField[]
}
interface RawForm { sha256: string; name: string; folder: string; type: string; category: string; pages: number; fields: unknown[] }

/** קריאה + ניקוי: שדה לא תקין או טופס בלי חתימה לכל לווה — לא נכנס (והבדיקה ב-tests נכשלת). */
export function parseCurated(raw: { forms: RawForm[] }): { forms: CuratedForm[]; errors: string[] } {
  const forms: CuratedForm[] = [], errors: string[] = []
  for (const r of raw.forms ?? []) {
    const fields = (r.fields ?? []).map((f, i) => cleanField({ ...(f as object), id: 'c' + (i + 1) }))
    const ok = fields.filter((f): f is PdfField => !!f)
    const signers = signersNeeded(ok)
    const errs = [
      ...(!/^[0-9a-f]{64}$/.test(r.sha256) ? ['טביעה לא תקינה'] : []),
      ...(ok.length !== fields.length ? ['שדה לא תקין'] : []),
      ...(!(r.type in FORM_TYPES) ? ['סוג לא מוכר'] : []),
      ...(!(r.category in SIGN_CATEGORIES) ? ['קטגוריה לא מוכרת'] : []),
      ...validatePdfFields(ok, r.pages, Math.max(1, signers)),
    ]
    if (errs.length) { errors.push(`${r.folder} / ${r.name}: ${errs.join(' · ')}`); continue }
    forms.push({ sha256: r.sha256, name: r.name, folder: r.folder, type: r.type as FormType, category: r.category as SignCategory, pages: r.pages, signers, fields: ok })
  }
  return { forms, errors }
}

let cache: Map<string, CuratedForm> | null = null
const index = () => (cache ??= new Map(parseCurated(data as { forms: RawForm[] }).forms.map((f) => [f.sha256, f])))

/** בדיקות קצה-לקצה בלבד: SIGN_CURATED_EXTRA = נתיב לקובץ באותו מבנה (טופס סינתטי) — נקרא מחדש כשהקובץ משתנה. */
let extra: { at: number; map: Map<string, CuratedForm> } | null = null
function extraIndex(): Map<string, CuratedForm> | null {
  const p = process.env.SIGN_CURATED_EXTRA
  if (!p) return null
  try {
    const at = statSync(p).mtimeMs
    if (!extra || extra.at !== at) extra = { at, map: new Map(parseCurated(JSON.parse(readFileSync(p, 'utf8'))).forms.map((f) => [f.sha256, f])) }
    return extra.map
  } catch { return null }
}

export const curatedFor = (sha: string): CuratedForm | null => { const k = String(sha ?? '').toLowerCase(); return index().get(k) ?? extraIndex()?.get(k) ?? null }
export const curatedCount = () => index().size + (extraIndex()?.size ?? 0)
