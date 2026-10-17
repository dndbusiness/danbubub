import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  AGREEMENT_FIELDS, approveItem, isPristine, LIB_DRAFT, libItemKey, mergeLibrary, parseAgreement, parseFrontMatter, stripLibDraft, suggestTemplate, textHash,
  type LibItem, type LibTemplate,
} from '../lib/rules/agreements.js'
import { isSignDraft, maskPhone, otpChannel, renderAgreement, requiredFields, templateFields, validateSigners, waTarget } from '../lib/rules/sign.js'

const DIR = path.join(process.cwd(), 'data', 'agreements')
const files = readdirSync(DIR).filter((n) => n.endsWith('.md')).sort()
const parsed = files.map((n) => ({ n, r: parseAgreement(readFileSync(path.join(DIR, n), 'utf8'), n) }))
const lib: LibTemplate[] = parsed.flatMap(({ r }) => (r.ok ? [r.tpl] : []))

describe('ספריית ההסכמים — הקבצים', () => {
  it('כל קובץ נקרא בלי שגיאות, key ייחודי', () => {
    for (const { n, r } of parsed) expect(r.ok ? [] : r.errors, n).toEqual([])
    expect(files.length).toBeGreaterThanOrEqual(9)
    expect(new Set(lib.map((t) => t.key)).size).toBe(lib.length)
  })

  it('כל שדה בנוסח מוכר ויש לו תווית — וזהה ל-SIGN_LABELS בדף', () => {
    for (const t of lib) for (const f of templateFields(t.body)) expect(AGREEMENT_FIELDS[f], `${t.key}: ${f}`).toBeTruthy()
    const html = readFileSync(path.join(process.cwd(), 'crm', 'harel-crm.html'), 'utf8')
    const m = /const SIGN_LABELS = (\{[\s\S]*?\});/.exec(html)
    expect(m).toBeTruthy()
    const pageLabels = new Function('return ' + m![1]!.replace(/\/\*[\s\S]*?\*\//g, ''))() as Record<string, string>
    expect(pageLabels).toEqual(AGREEMENT_FIELDS)
  })

  it('אין בנוסחים פרטים אישיים של לקוח (ת"ז, טלפון, מייל) — רק ח.פ של החברה', () => {
    for (const t of lib) {
      const nums = (t.body.match(/\d{9,}/g) ?? []).filter((x) => x !== '516857083')
      expect(nums, t.key).toEqual([])
      expect(t.body, t.key).not.toMatch(/\b05\d[-\s]?\d{7}\b/)
      expect(t.body, t.key).not.toMatch(/@[a-z0-9-]+\.[a-z]/i)
    }
  })

  it('כל נוסח מתמלא בלי חורים כשכל השדות קיימים; שדה רשות ריק לא חוסם', () => {
    const all = Object.fromEntries(Object.keys(AGREEMENT_FIELDS).map((k) => [k, 'x']))
    for (const t of lib) expect(renderAgreement(t.body, all).missing, t.key).toEqual([])
    const ref = lib.find((t) => t.key === 'finance-mortgage-refinance')!
    const noSpouse = { ...all, spouse_name: '', spouse_id: '' }
    expect(renderAgreement(ref.body, noSpouse).missing).toEqual([])
    expect(requiredFields(ref.body)).not.toContain('spouse_name')
    expect(templateFields(ref.body)).toContain('spouse_name')
  })

  it('קובץ לא תקין נדחה עם הסבר', () => {
    const bad = parseAgreement('---\nkey: Bad Key\nversion: 0\ntitle: x\ncategory: nope\ndivision: mars\n---\n{{unknown_field}} קצר', 'x.md')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/key.*version.*title.*category.*division/s)
    const draft = parseAgreement('---\nkey: abc\nversion: 1\ntitle: הסכם\ncategory: agreement\ndivision: finance\n---\n[טיוטה]\n' + 'א'.repeat(300), 'abc.md')
    expect(draft.ok).toBe(false)
  })

  it('front-matter: רשימות, בוליאנים, מספרים', () => {
    const { meta, body } = parseFrontMatter('---\na: [x, y]\nb: true\nc: 3\nd: "שלום"\n---\n\nגוף')
    expect(meta).toEqual({ a: ['x', 'y'], b: true, c: 3, d: 'שלום' })
    expect(body).toBe('גוף\n')
  })
})

describe('הצעת הסכם לפי מוצר', () => {
  const items = mergeLibrary([], lib, { at: '2026-10-17T00:00:00Z', by: 'dan' }).library
  const s = (division: string, product: string) => suggestTemplate(items, { division, product })
  it('כל מוצר עם הסכם מתאים, ונפילה להסכם ההתקשרות של החברה', () => {
    expect(s('finance', 'car_loan')).toBe(libItemKey('finance-car-credit'))
    expect(s('finance', 'vehicle_lien')).toBe(libItemKey('finance-car-credit'))
    expect(s('finance', 'refinance')).toBe(libItemKey('finance-mortgage-refinance'))
    expect(s('finance', 'state_guarantee')).toBe(libItemKey('finance-business-plan'))
    expect(s('finance', 'business_nonbank')).toBe(libItemKey('finance-business-plan'))
    expect(s('finance', 'nonbank_mortgage')).toBe(libItemKey('finance-property-pledge-loan'))
    expect(s('finance', 'mortgage_declined')).toBe(libItemKey('finance-property-pledge-loan'))
    expect(s('finance', 'new_mortgage')).toBe(libItemKey('finance-credit-general'))
    expect(s('realestate', 'presale')).toBe(libItemKey('realestate-service-order'))
    expect(s('realestate', 'secondhand')).toBe(libItemKey('realestate-service-order'))
    expect(s('finance', 'presale')).toBe('agreement:finance') // מוצר נדל"ן בחברת המימון — לא מציעים הסכם של החברה השנייה
    expect(s('finance', '')).toBe('agreement:finance')
    expect(suggestTemplate(items.map((x) => ({ ...x, deletedAt: x.key === libItemKey('finance-car-credit') ? 'x' : null })), { division: 'finance', product: 'car_loan' })).toBe(libItemKey('finance-car-credit-short'))
  })
})

describe('טעינת הספרייה ל-settings.signLibrary', () => {
  const at = '2026-10-17T10:00:00Z', at2 = '2026-10-18T10:00:00Z'
  const first = mergeLibrary([], lib, { at, by: 'dan' })

  it('כל מה שנטען — טיוטה שלא נשלחת', () => {
    expect(first.report.every((r) => r.action === 'added')).toBe(true)
    for (const x of first.library) { expect(isSignDraft(x.body)).toBe(true); expect(x.body.startsWith(LIB_DRAFT)).toBe(true); expect(isPristine(x)).toBe(true) }
  })

  it('idempotent: טעינה חוזרת = אותה ספרייה, הכל "ללא שינוי"', () => {
    const again = mergeLibrary(first.library, lib, { at: at2, by: 'dan' })
    expect(again.library).toEqual(first.library)
    expect(again.report.every((r) => r.action === 'unchanged')).toBe(true)
  })

  it('תבניות ידניות (לא מהספרייה) לא נגעים בהן', () => {
    const manual: LibItem = { key: 'tpl-1', title: 'טופס בנק', category: 'bank', body: 'x'.repeat(40) }
    const r = mergeLibrary([manual], lib, { at, by: 'dan' })
    expect(r.library[0]).toEqual(manual)
  })

  const v2 = lib.map((t) => (t.key === 'finance-car-credit' ? { ...t, version: t.version + 1, body: t.body + '\nסעיף חדש.\n' } : t))
  const carKey = libItemKey('finance-car-credit')

  it('גרסה חדשה מחליפה טיוטה שלא נגעו בה', () => {
    const r = mergeLibrary(first.library, v2, { at: at2, by: 'dan' })
    expect(r.report.find((x) => x.key === 'finance-car-credit')!.action).toBe('updated')
    expect(r.library.find((x) => x.key === carKey)!.body).toContain('סעיף חדש.')
  })

  it('גרסה חדשה לא דורסת נוסח שדן ערך או אישר — אלא אם סימן', () => {
    const edited = first.library.map((x) => (x.key === carKey ? { ...x, body: x.body + '\nתיקון של דן' } : x))
    const r = mergeLibrary(edited, v2, { at: at2, by: 'dan' })
    expect(r.report.find((x) => x.key === 'finance-car-credit')).toMatchObject({ action: 'conflict', reason: expect.stringContaining('נערכה') })
    expect(r.library.find((x) => x.key === carKey)!.body).toContain('תיקון של דן')

    const approved = first.library.map((x) => (x.key === carKey ? approveItem(x, 'dan', at) : x))
    const r2 = mergeLibrary(approved, v2, { at: at2, by: 'dan' })
    expect(r2.report.find((x) => x.key === 'finance-car-credit')!.action).toBe('conflict')
    const r3 = mergeLibrary(approved, v2, { at: at2, by: 'dan', overwrite: ['finance-car-credit'] })
    const x3 = r3.library.find((x) => x.key === carKey)!
    expect(r3.report.find((x) => x.key === 'finance-car-credit')!.action).toBe('overwritten')
    expect(isSignDraft(x3.body)).toBe(true)
    expect(x3.approvedAt).toBeNull()
    expect(x3.prevBody).toBe(approved.find((x) => x.key === carKey)!.body)
  })

  it('אותה גרסה — אישור ועריכה נשמרים (לא חוזר לטיוטה)', () => {
    const approved = first.library.map((x) => (x.key === carKey ? approveItem(x, 'dan', at) : x))
    const r = mergeLibrary(approved, lib, { at: at2, by: 'dan' })
    expect(r.library).toEqual(approved)
  })

  it('תבנית שנמחקה לא חוזרת בלי סימון', () => {
    const del = first.library.map((x) => (x.key === carKey ? { ...x, deletedAt: at } : x))
    const r = mergeLibrary(del, lib, { at: at2, by: 'dan' })
    expect(r.report.find((x) => x.key === 'finance-car-credit')).toMatchObject({ action: 'conflict', reason: 'נמחקה' })
    expect(r.library.find((x) => x.key === carKey)!.deletedAt).toBe(at)
    const back = mergeLibrary(del, lib, { at: at2, by: 'dan', overwrite: ['finance-car-credit'] })
    expect(back.library.find((x) => x.key === carKey)!.deletedAt).toBeUndefined()
  })
})

describe('אישור נוסח (טיוטה ← מאושר)', () => {
  const [x] = mergeLibrary([], lib.slice(0, 1), { at: '2026-10-17T00:00:00Z', by: 'dan' }).library
  it('האישור מוריד את הסימון ורושם מי ומתי', () => {
    const a = approveItem(x!, 'dan-id', '2026-10-17T12:00:00Z')
    expect(isSignDraft(a.body)).toBe(false)
    expect(a.body).toBe(lib[0]!.body)
    expect(a).toMatchObject({ approvedBy: 'dan-id', approvedAt: '2026-10-17T12:00:00Z', approvedVersion: lib[0]!.version })
  })
  it('סימון [טיוטה של דן בתוך הנוסח נשאר וחוסם גם אחרי האישור', () => {
    const own = { ...x!, body: x!.body + '\n[טיוטה — לבדוק סעיף 7]' }
    expect(isSignDraft(approveItem(own, 'dan', 'now').body)).toBe(true)
  })
  it('stripLibDraft לא נוגע בנוסח בלי הסימון; הטביעה יציבה', () => {
    expect(stripLibDraft('שלום')).toBe('שלום')
    expect(textHash('a\r\nb ')).toBe(textHash('a\nb'))
    expect(textHash('a')).not.toBe(textHash('b'))
  })
})

describe('חתימה — שדות רשות, טיוטה, קוד בוואטסאפ', () => {
  it('{{שדה?}} ריק מוצג "—"; {{שדה}} ריק — חסר', () => {
    const r = renderAgreement('# א\nבן זוג: {{spouse_name?}} · לקוח: {{client_name}}', { client_name: '' })
    expect(r.missing).toEqual(['client_name'])
    expect(r.html).toContain('בן זוג: —')
    expect(renderAgreement('{{spouse_name?}}', { spouse_name: 'דנה' }).html).toContain('<b>דנה</b>')
  })
  it('שדה שמופיע גם כחובה וגם כרשות — חובה', () => {
    expect(requiredFields('{{a?}} {{a}} {{b?}}')).toEqual(['a'])
    expect(renderAgreement('{{a?}} {{a}}', {}).missing).toEqual(['a'])
  })
  it('isSignDraft — רק הסימון בסוגריים', () => {
    expect(isSignDraft('[טיוטה — x]')).toBe(true)
    expect(isSignDraft('[ טיוטה')).toBe(true)
    expect(isSignDraft('הסכם זה ממצה כל טיוטה שקדמה לו')).toBe(false)
  })
  it('קוד אימות: מייל קודם; וואטסאפ רק כשמוגדר ויש טלפון', () => {
    expect(otpChannel({ send_email: 'a@b.co', send_phone: '0521234567' }, true)).toBe('email')
    expect(otpChannel({ send_email: null, send_phone: '0521234567' }, true)).toBe('whatsapp')
    expect(otpChannel({ send_email: null, send_phone: '0521234567' }, false)).toBeNull()
    expect(otpChannel({ send_email: null, send_phone: '' }, true)).toBeNull()
    expect(validateSigners([{ label: 'א', phone: '0521234567', requireOtp: true }])).toContain('א: קוד אימות נשלח במייל — חסר מייל')
    expect(validateSigners([{ label: 'א', phone: '0521234567', requireOtp: true }], { otpWhatsApp: true })).toEqual([])
    expect(waTarget('052-123-4567')).toBe('972521234567')
    expect(waTarget('+972521234567')).toBe('972521234567')
    expect(waTarget('12')).toBeNull()
    expect(maskPhone('0521234567')).toBe('052***4567')
  })
})
