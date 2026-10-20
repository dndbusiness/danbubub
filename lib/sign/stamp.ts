/**
 * חותמת החברה (דן, 20/10: "חותמת חברה — לעלות בכל מקום של חתימת החברה").
 * דן מעלה פעם אחת בהגדרות (PNG שקוף, הרקע מנוקה בדפדפן); נשמרת ב-stored_files ו-settings.companyStamp.
 * כל מסמך שנשלח שומר את מזהה החותמת שהייתה באותו רגע (@stamp) — החלפת חותמת לא משנה מסמכים שכבר נשלחו.
 */
import { crmSettings } from '@/lib/crm/auth'
import { readStoredFile } from '@/lib/files'

export async function currentStampId(): Promise<string | null> {
  const s = await crmSettings().catch(() => null) as { companyStamp?: { fileId?: string } } | null
  return s?.companyStamp?.fileId ?? null
}

export async function stampDataUrl(fileId: string | null | undefined): Promise<string | null> {
  if (!fileId) return null
  const f = await readStoredFile(fileId).catch(() => null)
  if (!f || !/^image\//.test(f.mime)) return null
  return `data:${f.mime};base64,${f.bytes.toString('base64')}`
}
