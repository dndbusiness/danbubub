import { describe, expect, it } from 'vitest'
import { escapeHtml, expiryFrom, isValidIsraeliId, normalizeIsraeliId, renderAgreement, signState, templateFields, validateSubmission, withNotes, SIGN_HERE_HTML, PAGE_BREAK_HTML } from '@/lib/rules/sign.js'

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

describe('מערכת חתימות — כמה חותמים, קוד אימות', async () => {
  const { validateSigners, maskEmail, otpState, canResendOtp, groupByDocument, OTP_MAX_ATTEMPTS } = await import('@/lib/rules/sign.js')
  it('חותמים: מייל או טלפון לכל אחד, מייל תקין, בלי כפילות, קוד אימות דורש מייל', () => {
    expect(validateSigners([{ label: 'לווה 1', email: 'a@b.co' }, { label: 'לווה 2', phone: '0501234567' }])).toEqual([])
    expect(validateSigners([])).toEqual(['אין חותמים'])
    expect(validateSigners([{ label: 'לווה 1' }])).toEqual(['לווה 1: חסר מייל או טלפון'])
    expect(validateSigners([{ label: 'א', email: 'x' }])).toContain('א: מייל לא תקין')
    expect(validateSigners([{ label: 'א', email: 'a@b.co' }, { label: 'ב', email: 'A@b.co' }])).toContain('ב: אותו מייל לשני חותמים')
    expect(validateSigners([{ label: 'א', phone: '050', requireOtp: true }])).toContain('א: קוד אימות נשלח במייל — חסר מייל')
    expect(validateSigners(Array.from({ length: 7 }, (_, i) => ({ label: 'ח' + i, phone: '05' + i })))).toContain('עד 6 חותמים במסמך')
  })
  it('מייל מוסתר בדף החתימה', () => {
    expect(maskEmail('dana@gmail.com')).toBe('da***@gmail.com')
    expect(maskEmail('a@x.co')).toBe('a***@x.co')
    expect(maskEmail(null)).toBe('')
  })
  it('מצב הקוד: לא נדרש / צריך לשלוח / נשלח / ננעל / אומת', () => {
    const now = new Date('2026-10-14T10:00:00Z'), later = '2026-10-14T10:05:00Z', past = '2026-10-14T09:55:00Z'
    const base = { require_otp: true, otp_verified_at: null, otp_hash: 'h', otp_expires_at: later, otp_attempts: 0 }
    expect(otpState({ ...base, require_otp: false }, now)).toBe('not_required')
    expect(otpState({ ...base, otp_hash: null }, now)).toBe('need_send')
    expect(otpState({ ...base, otp_expires_at: past }, now)).toBe('need_send')
    expect(otpState(base, now)).toBe('sent')
    expect(otpState({ ...base, otp_attempts: OTP_MAX_ATTEMPTS }, now)).toBe('locked')
    expect(otpState({ ...base, otp_verified_at: past }, now)).toBe('verified')
  })
  it('קוד חדש — פעם בדקה', () => {
    const now = new Date('2026-10-14T10:00:00Z')
    expect(canResendOtp(null, now)).toBe(true)
    expect(canResendOtp('2026-10-14T09:59:30Z', now)).toBe(false)
    expect(canResendOtp('2026-10-14T09:58:59Z', now)).toBe(true)
  })
  it('PDF משותף: חותמים עם אותו נוסח יחד, נוסח נפרד לחותם — קבוצה משלו, לפי סדר החותמים', () => {
    const g = groupByDocument([{ doc_hash: 'b', signer_order: 3 }, { doc_hash: 'a', signer_order: 1 }, { doc_hash: 'a', signer_order: 2 }])
    expect(g.map((x) => [x.doc_hash, x.rows.map((r) => r.signer_order)])).toEqual([['a', [1, 2]], ['b', [3]]])
  })
})

describe('הסכמים של דן (20/10): חתימות בגוף, עמוד חדש, שורות רשות, הערות בסוף', () => {
  it('@@חתימות@@ ו-@@עמוד חדש@@ — סימונים, לא טקסט', () => {
    const { html, missing } = renderAgreement('# הסכם\nטקסט {{client_name}}\n@@חתימות@@\n@@עמוד חדש@@\n# שטר חוב\n@@חתימות@@', { client_name: 'יוסי' })
    expect(missing).toEqual([])
    expect(html.split(SIGN_HERE_HTML).length - 1).toBe(2)
    expect(html).toContain(PAGE_BREAK_HTML)
    expect(html).not.toContain('@@')
  })
  it('שורה שכל השדות בה רשות וריקים — לא מוצגת; עם ערך — מוצגת', () => {
    const t = 'לקוח: {{client_name}}\nבן/בת זוג: {{spouse_name?}} · ת"ז: {{spouse_id?}}\nסוף'
    expect(renderAgreement(t, { client_name: 'א' }).html).not.toContain('בן/בת זוג')
    expect(renderAgreement(t, { client_name: 'א', spouse_name: 'ב' }).html).toContain('בן/בת זוג: <b>ב</b> · ת&quot;ז: —')
  })
  it('הערות: בהסכם תמיד יש סעיף; לפני מסמך מצורף (שטר) ולא אחריו', () => {
    expect(withNotes('# הסכם\nגוף', '', true)).toBe('# הסכם\nגוף\n\n# הערות\nאין הערות.')
    expect(withNotes('# הסכם\nגוף', '')).toBe('# הסכם\nגוף')
    const t = withNotes('# הסכם\nגוף\n\n@@עמוד חדש@@\n\n# שטר חוב\n@@חתימות@@', 'הנחה של 500 ₪', true)
    expect(t.indexOf('# הערות')).toBeLessThan(t.indexOf('@@עמוד חדש@@'))
    expect(t).toContain('# הערות\nהנחה של 500 ₪')
    expect(withNotes('x', '@@חתימות@@ בהערה', true)).toContain('‏@@חתימות@@') // הערה לא יכולה להוסיף מקום חתימה
  })
})
