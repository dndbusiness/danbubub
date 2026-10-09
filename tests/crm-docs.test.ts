import { describe, expect, it } from 'vitest'
import { applySet, applyUpdate, docsFromDump, parsePath } from '@/lib/crm/docs.js'
import { plainBody } from '@/lib/crm/google-tools.js'

describe('CRM — נתיבי מסמכים', () => {
  it('אוסף/מזהה בלבד', () => {
    expect(parsePath('clients/abc')).toEqual(['clients', 'abc'])
    expect(parsePath('settings/main')).toEqual(['settings', 'main'])
    expect(parsePath('clients')).toBeNull()
    expect(parsePath('a/b/c')).toBeNull()
    expect(parsePath('bad coll/x')).toBeNull()
    expect(parsePath(42)).toBeNull()
  })
})

describe('CRM — set / update כמו במסד של Claude', () => {
  it('update ממזג ברמה העליונה ומחליף אובייקט פנימי כולו', () => {
    const cur = { name: 'אריאל', proc: { type: 'mortgage', step: 'docs' }, tags: ['a'] }
    expect(applyUpdate(cur, { proc: { type: 'car' }, phone: '050' })).toEqual({ name: 'אריאל', proc: { type: 'car' }, tags: ['a'], phone: '050' })
  })
  it('update על מסמך חסר יוצר אותו', () => {
    expect(applyUpdate(null, { a: 1 })).toEqual({ a: 1 })
  })
  it('{__delete__:true} מוחק שדה, גם בעומק', () => {
    expect(applyUpdate({ a: 1, b: 2 }, { b: { __delete__: true } })).toEqual({ a: 1 })
    expect(applyUpdate({}, { o: { x: 1, y: { __delete__: true } } })).toEqual({ o: { x: 1 } })
  })
  it('set לא מקבל סמני מחיקה ולא מחרוזת', () => {
    expect(() => applySet({ a: { __delete__: true } })).toThrow()
    expect(() => applySet('{"a":1}')).toThrow()
    expect(applySet({ a: [1, { b: 2 }] })).toEqual({ a: [1, { b: 2 }] })
  })
})

describe('CRM — קובץ הגיבוי של הדף', () => {
  it('מפרק אוספים + settings/main, ומוריד את id הכפול מתוך המסמך', () => {
    const { docs, colls } = docsFromDump({ settings: { vatRate: 0.18 }, collections: { clients: { c1: { id: 'c1', name: 'x' } }, leads: {} } })
    expect(colls).toEqual(['clients', 'leads', 'settings'])
    expect(docs).toEqual([{ coll: 'clients', id: 'c1', data: { name: 'x' } }, { coll: 'settings', id: 'main', data: { vatRate: 0.18 } }])
  })
  it('קובץ שאינו גיבוי נדחה', () => {
    expect(() => docsFromDump({} as never)).toThrow()
  })
})

describe('Gmail — גוף טקסט', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64url')
  it('מעדיף text/plain', () => {
    expect(plainBody({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<b>x</b>') } }, { mimeType: 'text/plain', body: { data: b64('שלום') } }] })).toBe('שלום')
  })
  it('בלי text/plain — HTML בלי תגיות', () => {
    expect(plainBody({ mimeType: 'text/html', body: { data: b64('<p>שורה<br>שנייה</p>') } })).toBe('שורה\nשנייה')
  })
})
