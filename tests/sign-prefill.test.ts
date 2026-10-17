import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { cleanNotes, cleanPrefill, deviceLabel, identityCheck, pdfSignerHash, renderAgreement, signEvent, withNotes } from '@/lib/rules/sign'
import { checkSignerValues, cleanField, type PdfField } from '@/lib/rules/sign-pdf'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('מילוי מהתיק (דן, 17/10)', () => {
  it('cleanPrefill: רק שם, ת"ז ספרות ושדות מותרים', () => {
    const p = cleanPrefill({ name: '  דנה  כהן ', idNumber: '012-345-674', values: { f1: 'dana@x.co', f2: 'אחר', 'bad/key': 'x', f3: '' }, extra: 'x' }, ['f1', 'f3'])
    expect(p).toEqual({ name: 'דנה  כהן', idNumber: '012345674', values: { f1: 'dana@x.co' } })
    expect(cleanPrefill(null)).toEqual({})
    expect(cleanPrefill({ name: 'x'.repeat(500) }).name).toHaveLength(120)
  })

  it('cleanField שומר src רק לשדה טקסט ורק מהרשימה', () => {
    const base = { id: 'a', page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.03, signer: 1 }
    expect(cleanField({ ...base, kind: 'text', src: 'signer_email' })?.src).toBe('signer_email')
    expect(cleanField({ ...base, kind: 'text', src: 'drop_tables' })?.src).toBeUndefined()
    expect(cleanField({ ...base, kind: 'name', src: 'signer_email' })?.src).toBeUndefined()
  })

  it('identityCheck: ת"ז מדויקת (עם אפסים מובילים), שם בלי גרשיים ורווחים כפולים', () => {
    expect(identityCheck({ name: 'דנה כהן', idNumber: '12345674' }, 'דנה  כהן', '012345674')).toEqual({ id: true, name: true })
    expect(identityCheck({ name: 'דנה כהן', idNumber: '012345674' }, 'רונית לוי', '123456782')).toEqual({ id: false, name: false })
    expect(identityCheck({}, 'דנה', '012345674')).toEqual({ id: null, name: null })
    expect(identityCheck(null, 'דנה', '012345674')).toEqual({ id: null, name: null })
  })
})

describe('הערות לטופס', () => {
  it('cleanNotes: שורות נשמרות, בלי {{ ובלי תווי בקרה, עד 2000', () => {
    expect(cleanNotes('  מחיר מיוחד {{fee}}\r\n\r\n\r\nעד 31/10  ')).toBe('מחיר מיוחד { {fee} }\n\nעד 31/10')
    expect(cleanNotes('a\u0007b')).toBe('a b')
    expect(cleanNotes('x'.repeat(5000))).toHaveLength(2000)
    expect(cleanNotes(null)).toBe('')
  })

  it('withNotes: ההערות נכנסות לנוסח — ולכן לטביעה ולמה שנחתם', () => {
    const t = '# הסכם\nשלום {{client_name}}'
    const a = renderAgreement(withNotes(t, cleanNotes('הנחה של 500 ₪\n- לא רשימה')), { client_name: 'דנה' })
    expect(a.html).toContain('<h2>הערות</h2>')
    expect(a.html).toContain('הנחה של 500 ₪')
    expect(a.html).not.toContain('<ol>')
    expect(withNotes(t, '')).toBe(t)
    // {{ בהערות לא הופך לשדה חסר
    expect(renderAgreement(withNotes(t, cleanNotes('{{secret}}')), { client_name: 'דנה' }).missing).toEqual([])
  })

  it('טביעת טופס PDF משתנה כשההערות משתנות, וזהה בלי הערות לצורה הישנה', () => {
    const mine = [{ id: 'f1' }]
    expect(pdfSignerHash(sha, 'abc', mine, '')).toBe(sha('abc:' + JSON.stringify(mine)))
    expect(pdfSignerHash(sha, 'abc', mine, 'א')).not.toBe(pdfSignerHash(sha, 'abc', mine, 'ב'))
  })

  it('שדה הערות בטופס: נכתב מה שהשולח כתב, לא מה שהדפדפן שלח', () => {
    const fields: PdfField[] = [
      { id: 'n', page: 0, x: 0, y: 0, w: 0.5, h: 0.05, kind: 'text', signer: 1, src: 'notes' },
      { id: 't', page: 0, x: 0, y: 0.1, w: 0.5, h: 0.05, kind: 'text', signer: 1, required: true },
    ]
    const r = checkSignerValues(fields, 1, { n: 'זויף', t: 'בסדר' }, 'הנחה 500')
    expect(r.values).toEqual({ n: 'הנחה 500', t: 'בסדר' })
    expect(r.errors).toEqual([])
    expect(checkSignerValues(fields, 1, { t: 'x' }, '').values).toEqual({ t: 'x' })
  })
})

describe('תיעוד החתימה', () => {
  it('signEvent: מועד ISO, IP ומכשיר מקוצרים', () => {
    const e = signEvent('opened', new Date('2026-10-17T10:00:00Z'), { ip: '1.2.3.4', ua: 'u'.repeat(500), detail: null })
    expect(e).toEqual({ at: '2026-10-17T10:00:00.000Z', kind: 'opened', ip: '1.2.3.4', ua: 'u'.repeat(300) })
  })

  it('deviceLabel', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari')
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36')).toBe('Android · Chrome')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0')).toBe('Windows · Edge')
    expect(deviceLabel(null)).toBe('—')
  })
})
