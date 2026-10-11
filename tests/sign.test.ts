import { describe, expect, it } from 'vitest'
import { escapeHtml, expiryFrom, isValidIsraeliId, normalizeIsraeliId, renderAgreement, signState, templateFields, validateSubmission } from '@/lib/rules/sign.js'

describe('חתימה — ת"ז', () => {
  it('ספרת ביקורת', () => {
    expect(isValidIsraeliId('123456782')).toBe(true)
    expect(isValidIsraeliId('123456789')).toBe(false)
    expect(isValidIsraeliId('000000018')).toBe(true)
  })
  it('משלים אפסים משמאל ומתעלם מתווים', () => {
    expect(normalizeIsraeliId('18')).toBe('000000018')
    expect(isValidIsraeliId('18')).toBe(true)
    expect(isValidIsraeliId('12345678-2')).toBe(true)
    expect(normalizeIsraeliId('1234567890')).toBeNull()
  })
  it('ריק ואפסים — לא תקין', () => {
    expect(isValidIsraeliId('')).toBe(false)
    expect(isValidIsraeliId('000000000')).toBe(false)
  })
})

describe('חתימה — נוסח', () => {
  const tpl = '# הסכם התקשרות — {{client_name}}\n\nבין {{company}} לבין {{client_name}}.\nשכר הטרחה: {{fee}}.\n\n- סעיף ראשון\n- סעיף {{missing_one}}'
  it('ממלא שדות ומבריח HTML', () => {
    const { html, missing } = renderAgreement(tpl, { client_name: 'דנה <script>', company: 'הר-אל', fee: '2% + מע"מ' })
    expect(html).toContain('<h2>הסכם התקשרות — <b>דנה &lt;script&gt;</b></h2>')
    expect(html).toContain('<b>2% + מע&quot;מ</b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<ol><li>סעיף ראשון</li><li>סעיף __________</li></ol>')
    expect(missing).toEqual(['missing_one'])
  })
  it('הנוסח עצמו לא יכול להזריק HTML', () => {
    expect(renderAgreement('<img src=x onerror=alert(1)>', {}).html).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
  })
  it('שורות צמודות = פסקה אחת עם שבירת שורה', () => {
    expect(renderAgreement('א\nב\n\nג', {}).html).toBe('<p>א<br>ב</p>\n<p>ג</p>')
  })
  it('רשימת השדות לפי סדר הופעה, בלי כפילויות', () => {
    expect(templateFields(tpl)).toEqual(['client_name', 'company', 'fee', 'missing_one'])
  })
  it('escapeHtml', () => { expect(escapeHtml(`a&b"c'd`)).toBe('a&amp;b&quot;c&#39;d') })
})

describe('חתימה — מצב הקישור', () => {
  const now = new Date('2026-10-11T10:00:00Z')
  it('פתוח / פג / חתום / בוטל', () => {
    expect(signState({ status: 'sent', expires_at: '2026-10-12T00:00:00Z' }, now)).toBe('open')
    expect(signState({ status: 'opened', expires_at: '2026-10-11T09:59:59Z' }, now)).toBe('expired')
    expect(signState({ status: 'signed', expires_at: '2026-10-01T00:00:00Z' }, now)).toBe('signed')
    expect(signState({ status: 'sent', expires_at: '2026-10-12T00:00:00Z', deleted_at: '2026-10-11T08:00:00Z' }, now)).toBe('cancelled')
    expect(signState({ status: 'cancelled', expires_at: '2026-10-12T00:00:00Z' }, now)).toBe('cancelled')
  })
  it('תוקף: ברירת מחדל 14 יום, בין 1 ל-60', () => {
    expect(expiryFrom(now, undefined).toISOString()).toBe('2026-10-25T10:00:00.000Z')
    expect(expiryFrom(now, -5).toISOString()).toBe('2026-10-12T10:00:00.000Z')
    expect(expiryFrom(now, 999).toISOString()).toBe('2026-12-10T10:00:00.000Z')
  })
})

describe('חתימה — טופס הלקוח', () => {
  const sig = 'data:image/png;base64,' + 'A'.repeat(4000)
  it('תקין', () => { expect(validateSubmission({ name: 'דנה כהן', idNumber: '123456782', signature: sig, agree: true })).toEqual([]) })
  it('כל השגיאות בבת אחת', () => {
    const e = validateSubmission({ name: ' ', idNumber: '123456789', signature: 'data:image/png;base64,AA', agree: false })
    expect(e).toEqual(['נא למלא שם מלא', 'מספר תעודת הזהות לא תקין', 'החתימה קצרה מדי — נא לחתום שוב', 'נא לאשר שקראת את ההסכם ושאתה מסכים לו'])
  })
  it('חתימה שאינה PNG', () => {
    expect(validateSubmission({ name: 'דנה', idNumber: '123456782', signature: 'javascript:alert(1)', agree: true })).toEqual(['נא לחתום במסגרת'])
  })
})
