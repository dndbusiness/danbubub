/**
 * קריאת קובץ שהועלה (xlsx / xls / csv) לשורות גולמיות.
 * CSV נקרא כ-UTF-8 (codepage 65001) — בלי זה כותרות בעברית מגיעות מקולקלות
 * וזיהוי הפורמט נכשל. קבצי xlsx מתעלמים מה-codepage.
 */
import * as xlsx from 'xlsx'
import type { Cell } from './workbook.js'

export function rowsFromBuffer(buf: Buffer | Uint8Array, sheet?: string): { sheetName: string; rows: Cell[][] } {
  const wb = xlsx.read(buf, { type: 'buffer', raw: true, codepage: 65001, cellDates: false })
  const sheetName = sheet && wb.Sheets[sheet] ? sheet : wb.SheetNames[0]!
  const ws = wb.Sheets[sheetName]!
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as Cell[][]
  return { sheetName, rows }
}
