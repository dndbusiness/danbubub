/**
 * אירועי יומן — ADDENDUM ב.2. טהור: קלט מהנתונים → רשימת אירועים ל-60 יום קדימה.
 * כל אירוע: כותרת שמתחילה ב-[כספים], rule_key ייחודי (extendedProperties.private) כדי לעדכן ולא להכפיל
 * (ב.1 "יומנים"), משתתפים לפי הטבלה. תוכן "חי" (חריגים, סכומים) מתעדכן בכל sync.
 */
import { addDays, addMonths, dayInMonth, monthOf, type IsoDate } from './period.js'

export interface CalendarEvent {
  ruleKey: string
  title: string
  /** תאריך + שעה מקומית (Asia/Jerusalem), או יום שלם. */
  date: IsoDate
  time?: string // HH:MM
  durationMinutes?: number
  description: string
  attendees: string[]
  link?: string
}

export interface CalendarPlanInput {
  asOf: IsoDate
  horizonDays?: number
  baseUrl?: string
  people: { dan?: string | null; nissim?: string | null; hadas?: string | null }
  settings: { payrollApprovalDay?: number; payrollPayDay?: number; accountantCloseDay?: number; vatDay?: number; vatBimonthly?: boolean }
  /** לסגירת החודש (30): חריגים חוסמים פתוחים. */
  closingBlockers: { month: string; items: string[] }[]
  /** להעברות (10): סכום ההעברה מהסגירה האחרונה. */
  transferDue: { month: string; amount: number } | null
  /** מקדמה (18): ממוצע 3 חודשים. */
  expectedAdvance: number
  /** אישור שכר (27): מי עדיין draft. */
  payrollDrafts: { month: string; names: string[] }[]
  /** תשלום שכר: עלות כוללת + פירוט. */
  payrollTotals: { month: string; total: number; lines: string[] }[]
  /** סגירה לרו"ח (12): צ'קליסט ✓/✗. */
  accountantChecklist: { month: string; items: { label: string; done: boolean }[] }[]
  /** מע"מ (15): חבות. */
  vatLiability: { month: string; amount: number }[]
  /** חיובי אשראי לפי billing_day. */
  cardCharges: { accountId: string; name: string; billingDay: number; expected: number; details: string[] }[]
  /** תקבולים צפויים committed. */
  receipts: { planId: string; date: IsoDate; client: string; amount: number; nextMissing?: string | null }[]
  /** תיקים נרקבים. */
  decayedDeals: { dealId: string; client: string; daysStale: number; ownerEmail?: string | null }[]
  /** עוגן לא עודכן 48 שעות. */
  anchorStale: { lastDate: IsoDate | null } | null
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('he-IL')} ₪`

function clampDay(month: string, day: number): IsoDate { return dayInMonth(month, day) }

export function planCalendarEvents(input: CalendarPlanInput): CalendarEvent[] {
  const { asOf, baseUrl = '', people } = input
  const horizon = addDays(asOf, input.horizonDays ?? 60)
  // ערך undefined בהגדרות לא דורס את ברירת המחדל (אחרת יום = NaN).
  const defined = Object.fromEntries(Object.entries(input.settings).filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'number' && Number.isNaN(v))))
  const s = { payrollApprovalDay: 27, payrollPayDay: 9, accountantCloseDay: 12, vatDay: 15, vatBimonthly: false, ...defined }
  const dan = people.dan ? [people.dan] : []
  const nissim = people.nissim ? [people.nissim] : []
  const hadas = people.hadas ? [people.hadas] : []
  const inWindow = (d: IsoDate) => d >= asOf && d <= horizon
  const L = (path: string) => (baseUrl ? `${baseUrl}${path}` : path)
  const out: CalendarEvent[] = []

  // חודשים בטווח (החודש הנוכחי + הבאים)
  const months: string[] = []
  for (let m = monthOf(asOf); m <= monthOf(horizon); m = addMonths(m, 1)) months.push(m)

  for (const m of months) {
    // סגירת חודש הר-אל מימון — 30 לחודש 10:00, דן + ניסים
    const close = clampDay(m, 30)
    if (inWindow(close)) {
      const blockers = input.closingBlockers.find((b) => b.month === m)?.items ?? []
      out.push({ ruleKey: `month_close:${m}`, title: `[כספים] סגירת חודש ${m} — כרטיס ניסים`, date: close, time: '10:00', durationMinutes: 30, attendees: [...dan, ...nissim], link: L(`/nissim?period=${m}`),
        description: `${L(`/nissim?period=${m}`)}\n${blockers.length ? `חריגים פתוחים שחוסמים סגירה (${blockers.length}):\n• ${blockers.join('\n• ')}` : 'אין חריגים חוסמים ✓'}` })
    }
    // העברות התחשבנות — 10 לחודש 09:00, דן
    const transfer = clampDay(m, 10)
    if (inWindow(transfer)) {
      const due = input.transferDue && addMonths(input.transferDue.month, 1) === m ? input.transferDue.amount : null
      out.push({ ruleKey: `settlement_transfer:${m}`, title: `[כספים] העברת התחשבנות${due ? ` — ${fmt(due)}` : ''}`, date: transfer, time: '09:00', durationMinutes: 15, attendees: dan, link: L('/nissim'),
        description: due ? `סכום ההעברה מהסגירה: ${fmt(due)}\nלסימון "בוצע": ${L('/nissim')}` : `סכום ההעברה ייקבע בסגירת החודש הקודם.\n${L('/nissim')}` })
    }
    // מקדמה חודשית לניסים — 18
    const adv = clampDay(m, 18)
    if (inWindow(adv)) out.push({ ruleKey: `advance:${m}`, title: `[כספים] מקדמה חודשית לניסים${input.expectedAdvance ? ` — ~${fmt(input.expectedAdvance)}` : ''}`, date: adv, attendees: dan, link: L('/nissim'), description: `ממוצע 3 חודשים: ${fmt(input.expectedAdvance)}\n${L('/nissim')}` })
    // אישור שכר — 27 10:00
    const approve = clampDay(m, s.payrollApprovalDay)
    if (inWindow(approve)) {
      const drafts = input.payrollDrafts.find((p) => p.month === m)?.names ?? []
      out.push({ ruleKey: `payroll_approve:${m}`, title: `[כספים] אישור שכר ${m}`, date: approve, time: '10:00', durationMinutes: 30, attendees: dan, link: L('/payroll'),
        description: `${L('/payroll')}\n${drafts.length ? `עדיין בטיוטה: ${drafts.join(', ')}` : 'כל התלושים אושרו ✓'}\nהדוח לרו"ח יוצא 30–3.` })
    }
    // תשלום שכר — יום התשלום מההגדרות (על החודש הקודם)
    const pay = clampDay(m, s.payrollPayDay)
    if (inWindow(pay)) {
      const prev = addMonths(m, -1)
      const t = input.payrollTotals.find((p) => p.month === prev)
      out.push({ ruleKey: `payroll_pay:${m}`, title: `[כספים] תשלום שכר ${prev}${t ? ` — ${fmt(t.total)}` : ''}`, date: pay, attendees: dan, link: L('/payroll'), description: t ? `עלות כוללת ${fmt(t.total)}\n${t.lines.join('\n')}` : 'עדיין אין תחשיב שכר לחודש.' })
    }
    // סגירת חודש לרו"ח — 12 (על החודש הקודם), דן + הדס
    const acct = clampDay(m, s.accountantCloseDay)
    if (inWindow(acct)) {
      const prev = addMonths(m, -1)
      const cl = input.accountantChecklist.find((c) => c.month === prev)?.items ?? []
      out.push({ ruleKey: `accountant_close:${prev}`, title: `[כספים] סגירת חודש ${prev} לרו"ח`, date: acct, time: '09:00', durationMinutes: 30, attendees: [...dan, ...hadas], link: L(`/pnl?period=${prev}`),
        description: cl.length ? cl.map((i) => `${i.done ? '✓' : '✗'} ${i.label}`).join('\n') : 'צ\'קליסט ב.7 ייבנה עם הנתונים.' })
    }
    // דיווח מע"מ — 15 (או דו-חודשי)
    const vat = clampDay(m, s.vatDay)
    const bimonthlySkip = s.vatBimonthly && Number(m.slice(5, 7)) % 2 === 0
    if (inWindow(vat) && !bimonthlySkip) {
      const prev = addMonths(m, -1)
      const liab = input.vatLiability.find((v) => v.month === prev)?.amount
      out.push({ ruleKey: `vat:${m}`, title: `[כספים] דיווח מע"מ${liab !== undefined ? ` — ${fmt(liab)}` : ''}`, date: vat, attendees: dan, link: L('/vat'), description: `חבות מע"מ מחושבת נכון לבוקר: ${liab !== undefined ? fmt(liab) : 'טרם חושב'}\n${L('/vat')}` })
    }
    // חיוב כרטיס אשראי — לפי billing_day
    for (const c of input.cardCharges) {
      const d = clampDay(m, c.billingDay)
      if (!inWindow(d)) continue
      out.push({ ruleKey: `card_billing:${c.accountId}:${m}`, title: `[כספים] חיוב ${c.name} — ~${fmt(c.expected)}`, date: d, attendees: dan, link: L('/cashflow'), description: `סכום צפוי לפי הוצאות קבועות: ${fmt(c.expected)}\n${c.details.join('\n')}` })
    }
  }

  // דוח כספי שבועי — ימי שישי 08:00
  for (let d = asOf; d <= horizon; d = addDays(d, 1)) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 5) out.push({ ruleKey: `weekly_report:${d}`, title: '[כספים] דוח כספי שבועי', date: d, time: '08:00', durationMinutes: 15, attendees: dan, link: L('/settings'), description: `הדוח בדרייב: דוח-שבועי/\n${L('/settings')}` })
  }
  // תקבול צפוי מתיק — committed בלבד, דן + הדס
  for (const r of input.receipts) {
    if (!inWindow(r.date)) continue
    out.push({ ruleKey: `receipt:${r.planId}`, title: `[כספים] תקבול צפוי — ${r.client} ${fmt(r.amount)}`, date: r.date, attendees: [...dan, ...hadas], link: L('/deals'), description: `${r.client} · ${fmt(r.amount)}\n${r.nextMissing ? `מה חסר כדי לקבל: ${r.nextMissing}` : 'אין חסמים ✓'}` })
  }
  // עסקה נרקבת — אחראי התיק
  for (const d of input.decayedDeals) out.push({ ruleKey: `deal_decay:${d.dealId}`, title: `[כספים] תיק "${d.client}" ללא פעילות ${d.daysStale} יום`, date: asOf, attendees: d.ownerEmail ? [d.ownerEmail] : dan, link: L(`/deals/${d.dealId}`), description: `לעדכן סטטוס או לסגור.\n${L(`/deals/${d.dealId}`)}` })
  // עוגן לא עודכן — 48 שעות
  if (input.anchorStale) out.push({ ruleKey: `anchor_stale:${asOf}`, title: '[כספים] העוגן לא עודכן 48 שעות', date: asOf, attendees: dan, link: L('/anchor'), description: `העוגן האחרון: ${input.anchorStale.lastDate ?? 'אף פעם'}\n${L('/anchor')}` })

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ruleKey.localeCompare(b.ruleKey))
}

/** ב.2 "קריאה מהיומן": פגישה לשכר = כותרת מכילה "פגישה" + שם העובד. */
export function isEmployeeMeeting(title: string, employeeName: string): boolean {
  return /פגישה|meeting/i.test(title) && title.includes(employeeName)
}

/** תוכן זהה → אין עדכון (חוסך קריאות API ומונע "עודכן" סתם). */
export function eventFingerprint(e: CalendarEvent): string {
  return [e.title, e.date, e.time ?? '', e.durationMinutes ?? '', e.description, [...e.attendees].sort().join(',')].join('|')
}
