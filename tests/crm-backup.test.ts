import { describe, expect, it } from 'vitest'
import { docsFromDump, dumpFromDocs } from '@/lib/crm/docs'

describe('dumpFromDocs — גיבוי השרת באותו מבנה כמו גיבוי הדף', () => {
  const rows = [
    { coll: 'settings', doc_id: 'main', data: { ownerEmail: 'a@b.co', users: [{ username: 'hadas', hash: 'h', salt: 's' }] } },
    { coll: 'clients', doc_id: 'c1', data: { id: 'c1', name: 'כהן' } },
    { coll: 'clients', doc_id: 'c2', data: { name: 'Levi בע"מ' } },
    { coll: 'loginCodes', doc_id: 'c-dan', data: { hash: 'x' } },
    { coll: 'vcEvents', doc_id: 'e1', data: { payload: {} } },
    { coll: 'runs', doc_id: 'drive', data: { status: 'ok' } },
  ]
  const d = dumpFromDocs(rows, '2026-10-20T01:00:00.000Z', ['loginCodes', 'vcEvents'])

  it('settings/main יוצא כ-settings, עם הגיבובים (אחרת שחזור מאבד את הסיסמאות)', () => {
    expect(d.settings).toEqual(rows[0]!.data)
    expect(d.collections!.settings).toBeUndefined()
  })
  it('אוספים זמניים לא נכנסים', () => {
    expect(Object.keys(d.collections!).sort()).toEqual(['clients', 'runs'])
    expect(d.counts).toEqual({ clients: 2, runs: 1 })
  })
  it('הלוך-חזור: docsFromDump מחזיר את אותם מסמכים', () => {
    const back = docsFromDump(JSON.parse(JSON.stringify(d)))
    const key = (x: { coll: string; id: string }) => x.coll + '/' + x.id
    expect(back.docs.map(key).sort()).toEqual(['clients/c1', 'clients/c2', 'runs/drive', 'settings/main'])
    expect(back.docs.find((x) => x.id === 'c2')!.data).toEqual({ name: 'Levi בע"מ' })
    expect(back.colls.sort()).toEqual(['clients', 'runs', 'settings'])
  })
})
