/**
 * פרטי רכב לפי מספר רישוי — מאגר כלי הרכב של משרד התחבורה ב-data.gov.il (פתוח, בלי עלות).
 * מחזיר יצרן, דגם, שנתון, בעלות (פרטי / ליסינג / השכרה) ועוד. אין בו מחיר ואין בו שעבודים:
 * מחיר — מחירון (לוי יצחק וכו׳), שעבוד — רשם המשכונות. שניהם בתשלום ולא כאן.
 * פונקציות טהורות + קריאה אחת ל-fetch שמוזרק (לבדיקות).
 */
export const GOV_VEHICLES_URL = 'https://data.gov.il/api/3/action/datastore_search'
/** כלי רכב פרטיים ומסחריים פעילים (משרד התחבורה) */
export const GOV_VEHICLE_RESOURCES = ['053cea08-09bc-40ec-8f7a-156f0677aff3']

export interface CarInfo {
  plate: string; maker: string; model: string; trim: string; year: number | null; ownership: string
  color: string; fuel: string; onRoad: string; testValidUntil: string; modelCode: string
}

export const normPlate = (p: unknown): string => String(p ?? '').replace(/\D/g, '')
export const plateOk = (p: string): boolean => /^\d{5,8}$/.test(p)

const str = (v: unknown) => (v == null ? '' : String(v).trim())
const firstOf = (r: Record<string, unknown>, keys: string[]) => { for (const k of keys) { const v = str(r[k]); if (v) return v } return '' }

/** שורה מהמאגר → CarInfo. שמות השדות במאגר: mispar_rechev, tozeret_nm, kinuy_mishari, degem_nm, shnat_yitzur, baalut … */
export function carFromRecord(r: Record<string, unknown>): CarInfo {
  const year = Number(firstOf(r, ['shnat_yitzur']))
  return {
    plate: normPlate(r.mispar_rechev),
    maker: firstOf(r, ['tozeret_nm', 'tozeret_eretz_nm']),
    model: firstOf(r, ['kinuy_mishari', 'degem_nm']),
    trim: firstOf(r, ['ramat_gimur']),
    year: Number.isFinite(year) && year > 1900 ? year : null,
    ownership: firstOf(r, ['baalut']),
    color: firstOf(r, ['tzeva_rechev']),
    fuel: firstOf(r, ['sug_delek_nm']),
    onRoad: firstOf(r, ['moed_aliya_lakvish']),
    testValidUntil: firstOf(r, ['tokef_dt']).slice(0, 10),
    modelCode: firstOf(r, ['degem_nm']),
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export async function lookupCar(plateIn: unknown, fetchFn: Fetch = fetch as unknown as Fetch): Promise<{ ok: true; car: CarInfo } | { ok: false; code: string; message: string }> {
  const plate = normPlate(plateIn)
  if (!plateOk(plate)) return { ok: false, code: 'invalid_argument', message: 'מספר רכב לא תקין' }
  for (const rid of GOV_VEHICLE_RESOURCES) {
    const u = GOV_VEHICLES_URL + '?resource_id=' + rid + '&limit=1&filters=' + encodeURIComponent(JSON.stringify({ mispar_rechev: Number(plate) }))
    let res
    try { res = await fetchFn(u, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }) } catch { return { ok: false, code: 'unavailable', message: 'מאגר משרד התחבורה לא זמין כרגע' } }
    if (!res.ok) return { ok: false, code: 'unavailable', message: 'מאגר משרד התחבורה החזיר ' + res.status }
    const j = await res.json().catch(() => null) as { success?: boolean; result?: { records?: Record<string, unknown>[] } } | null
    const rec = j && j.success !== false ? j.result?.records?.[0] : undefined
    if (rec) return { ok: true, car: carFromRecord(rec) }
  }
  return { ok: false, code: 'not_found', message: 'הרכב לא נמצא במאגר משרד התחבורה' }
}
