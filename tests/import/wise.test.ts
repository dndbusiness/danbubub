import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rowsFromBuffer } from '@/lib/import/rows.js'
import {
  dedupeLeads, detectChannel, detectWiseExport, mapWiseStage, normalizePhone, parseWiseExport,
} from '@/lib/import/wise.js'

const load = (name: string) => rowsFromBuffer(readFileSync(`tests/fixtures/wise/${name}`)).rows
const leadsRows = load('leads-sample.csv')
const subRows = load('submissions-sample.csv')
const custRows = load('customers-sample.csv')

describe('ייבוא WISE — SPEC §4.5', () => {
  it('מזהה איזה משלושת הייצואים זה', () => {
    expect(detectWiseExport(leadsRows)?.kind).toBe('leads')
    expect(detectWiseExport(subRows)?.kind).toBe('submissions')
    expect(detectWiseExport(custRows)?.kind).toBe('customers')
    expect(detectWiseExport([['סתם', 'עמודות']])).toBeNull()
  })

  it('ממפה את סטטוסי WISE לרמות המשפך', () => {
    expect(mapWiseStage('ליד חדש')).toEqual({ stage: 'received', known: true })
    expect(mapWiseStage('חדשים לא נענו')).toEqual({ stage: 'received', known: true })
    expect(mapWiseStage('אין מענה')).toEqual({ stage: 'contacted', known: true })
    expect(mapWiseStage('נשלחו דוחות משכנתא')).toEqual({ stage: 'contacted', known: true })
    expect(mapWiseStage('נסגר וחתם')).toEqual({ stage: 'signed', known: true })
    expect(mapWiseStage('לקוח נסגר ועבר ללקוחות')).toEqual({ stage: 'signed', known: true })
    expect(mapWiseStage('לא רלוונטי')).toEqual({ stage: 'closed_lost', known: true })
    expect(mapWiseStage('קמפיינים ישנים')).toEqual({ stage: 'closed_lost', known: true })
  })

  it('סטטוס לא מוכר נכנס כ"ליד חדש" ומסומן — לא נעלם בשקט', () => {
    expect(mapWiseStage('בטיפול מיוחד')).toEqual({ stage: 'received', known: false })
    const r = parseWiseExport(leadsRows)
    if ('error' in r) throw new Error(r.error)
    expect(r.unknownStatuses).toContain('בטיפול מיוחד')
    expect(r.warnings.join(' ')).toContain('בטיפול מיוחד')
  })

  it('זיהוי ערוץ: אימייל הרכב → רכב-לנדינג + vehicle_lien', () => {
    expect(detectChannel('car-0521234567@car.com', 'טופס – אתר אינטרנט')).toEqual({
      source: 'רכב-לנדינג', product: 'vehicle_lien', certain: true,
    })
    expect(detectChannel('someone@example.com', 'טופס – אתר אינטרנט').source).toBe('טופס – אתר אינטרנט')
    expect(detectChannel(null, 'הוכנס ידנית').source).toBe('הוכנס ידנית')
    expect(detectChannel('someone@example.com', 'טופס – אתר אינטרנט').certain).toBe(false)
  })

  it('מנרמל טלפון — 972, מקפים ואפס חסר', () => {
    expect(normalizePhone('+972521234567')).toBe('0521234567')
    expect(normalizePhone('052-123-4567')).toBe('0521234567')
    expect(normalizePhone('521234567')).toBe('0521234567')
    expect(normalizePhone('')).toBeNull()
  })

  it('מפענח מתעניינים, מדלג על שורה בלי טלפון ובלי אימייל', () => {
    const r = parseWiseExport(leadsRows)
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('leads')
    expect(r.skipped).toBe(1)
    expect(r.leads).toHaveLength(6)
    const car = r.leads.find((l) => l.email?.startsWith('car-'))!
    expect(car.sourceName).toBe('רכב-לנדינג')
    expect(car.product).toBe('vehicle_lien')
    expect(car.phone).toBe('0521234567')
  })

  it('אותו ליד פעמיים — השלב המתקדם גובר, ו"אבוד" לא דורס התקדמות', () => {
    const r = parseWiseExport(leadsRows)
    if ('error' in r) throw new Error(r.error)
    const deduped = dedupeLeads(r.leads)
    expect(deduped.length).toBe(r.leads.length - 1)
    const car = deduped.find((l) => l.phone === '0521234567')!
    expect(car.stage).toBe('contacted')

    const sameRef = [
      { ...r.leads[0]!, wiseRef: 'x', stage: 'signed' as const },
      { ...r.leads[0]!, wiseRef: 'x', stage: 'closed_lost' as const },
    ]
    expect(dedupeLeads(sameRef)[0]!.stage).toBe('signed')
  })

  it('מפענח הגשות לבנקים עם מפתח שידוך של שם + בנק + תאריך', () => {
    const r = parseWiseExport(subRows)
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('submissions')
    expect(r.submissions).toHaveLength(3)
    const approved = r.submissions.find((s) => s.approvedAt)!
    expect(approved.bank).toBe('מזרחי טפחות')
    expect(approved.approvedAt).toBe('2026-09-18')
    expect(new Set(r.submissions.map((s) => s.wiseRef)).size).toBe(3)
  })

  it('מפענח לקוחות עם סכום שמכיל פסיקים', () => {
    const r = parseWiseExport(custRows)
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('customers')
    expect(r.customers).toHaveLength(2)
    expect(r.customers[0]!.amount).toBe(1_250_000)
    expect(r.customers[0]!.nationalId).toBe('123456782')
  })
})
