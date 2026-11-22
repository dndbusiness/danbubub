import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** איסוף מסמכים (דן 22/11) — אותו קוד שרץ במסך */
const html = readFileSync('crm/harel-crm.html', 'utf8')
const a = html.indexOf('/* ══ איסוף מסמכים — פונקציות טהורות'), b = html.indexOf('/* ══ סוף איסוף מסמכים ══ */')
const F = new Function(html.slice(a, b) + '; return { docMatch, docsAskText, docToks };')() as any

describe('מה הועלה ומה חסר', () => {
  const files = [{ id: '1', title: 'תעודת זהות דני.jpg' }, { id: '2', title: 'תלושי שכר 08-10.pdf' }, { id: '3', title: 'עובר ושב לאומי.pdf' }, { id: '4', title: 'Scan_0001.pdf' }]
  it('ת״ז + ספח ↔ "תעודת זהות"', () => expect(F.docMatch('דני — ת״ז + ספח', files).id).toBe('1'))
  it('3 תלושי שכר ↔ "תלושי שכר"', () => expect(F.docMatch('דני — 3 תלושי שכר אחרונים', files).id).toBe('2'))
  it('עו״ש ↔ "עובר ושב"', () => expect(F.docMatch('עו״ש 3 חודשים — כל החשבונות', files).id).toBe('3'))
  it('אין התאמה — חסר', () => expect(F.docMatch('נסח טאבו / אישור זכויות', files)).toBeNull())
})
describe('נוסח הבקשה ללקוח', () => {
  it('שם פרטי, רשימה ממוספרת, החברה', () => {
    const t = F.docsAskText('דני כהן', ['ת״ז + ספח', 'נסח טאבו'], 'הר-אל פתרונות מימון')
    expect(t.startsWith('שלום דני,')).toBe(true)
    expect(t).toContain('1. ת״ז + ספח\n2. נסח טאבו')
    expect(t.endsWith('הר-אל פתרונות מימון')).toBe(true)
  })
})
