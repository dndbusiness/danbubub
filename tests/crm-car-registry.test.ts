import { describe, it, expect } from 'vitest'
import { carFromRecord, lookupCar, normPlate, plateOk } from '@/lib/crm/car-registry'

const REC = { _id: 1, mispar_rechev: 1234567, tozeret_nm: 'טויוטה יפן', kinuy_mishari: 'COROLLA', degem_nm: 'ZWE211L', ramat_gimur: 'SUN', shnat_yitzur: 2021, baalut: 'פרטי', tzeva_rechev: 'לבן', sug_delek_nm: 'היברידי', moed_aliya_lakvish: '2021-3', tokef_dt: '2026-03-01T00:00:00' }

describe('car registry', () => {
  it('normalizes plates', () => {
    expect(normPlate('12-345-67')).toBe('1234567')
    expect(plateOk('1234567')).toBe(true)
    expect(plateOk('12')).toBe(false)
  })
  it('maps a registry record', () => {
    const c = carFromRecord(REC)
    expect(c).toMatchObject({ plate: '1234567', maker: 'טויוטה יפן', model: 'COROLLA', trim: 'SUN', year: 2021, ownership: 'פרטי', fuel: 'היברידי', testValidUntil: '2026-03-01' })
  })
  it('queries by plate and returns the first record', async () => {
    let url = ''
    const r = await lookupCar('12-345-67', async (u) => { url = u; return { ok: true, status: 200, json: async () => ({ success: true, result: { records: [REC] } }) } })
    expect(r.ok).toBe(true)
    expect(decodeURIComponent(url)).toContain('"mispar_rechev":1234567')
  })
  it('reports not found / invalid / unavailable', async () => {
    expect((await lookupCar('1234567', async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { records: [] } }) }))).ok).toBe(false)
    expect(await lookupCar('12', async () => { throw new Error('x') })).toMatchObject({ code: 'invalid_argument' })
    expect(await lookupCar('1234567', async () => { throw new Error('net') })).toMatchObject({ code: 'unavailable' })
  })
})
