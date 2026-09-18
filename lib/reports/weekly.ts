/**
 * דוח כספי שבועי — ADDENDUM ב.7. תשע השורות, עמוד אחד.
 *
 * החלטה 21 — הדוח נשלח בשלוש גרסאות לפי הרשאה:
 *   dan    — הכול, כולל יתרת הבנק והתחשבנות ניסים.
 *   nissim — מימון בלבד, **בלי יתרת בנק** (SPEC §6: יתרת הבנק היא אדמין בלבד).
 *   aviv   — נדל"ן בלבד.
 * אותה פונקציה מפיקה את הדוח למסך, ל-PDF ולמייל (הנחיה 20).
 */
import { sql } from '@/lib/db'
import { addDays, addMonths, monthOf, weekStart } from '@/lib/rules/period'
import { formatMoney } from '@/lib/ui/format'
import { bankAccount, latestAnchor, loadCashflow } from '@/lib/queries/cashflow'

export type Audience = 'dan' | 'nissim' | 'aviv'

export interface WeeklyReportData {
  weekStart: string
  weekEnd: string
  audience: Audience
  division: 'finance' | 'realestate' | 'all'
  showBank: boolean
  week: { collected: number; out: number; operationalProfit: number; netCashflow: number; balanceStart: number | null; balanceEnd: number | null }
  mtd: { month: string; collected: number; target: number | null; prevSamePoint: number; operational: number; distributable: number; income: number; fixed: number; direct: number }
  nissim: { month: string; distributable: number; share: number; advances: number; estimatedBalance: number } | null
  collections: { committed: number; expected: number; top: { client: string; amount: number; daysOverdue: number; missing: string | null }[]; movedIn: number; newOpen: number; rotted: number }
  pipeline: { signedThisWeek: number; signedAmount: number; lostThisWeek: number; leads: number; conversionPct: number; byChannel: { channel: string; leads: number; signings: number; cost: number }[] }
  cashflow: { weeks: { label: string; committed: number; weighted: number }[]; lowPoint: { date: string; balance: number } | null } | null
  exceptions: { missingInvoices: number; missingVat: number; unknownTx: number; fixedNotDebited: string[]; budgetOverruns: { name: string; over: number }[] }
  nextWeek: { charges: { date: string; label: string; amount: number }[]; receipts: { date: string; label: string; amount: number }[]; events: string[] }
}

const DIVISION_FOR: Record<Audience, 'finance' | 'realestate' | 'all'> = { dan: 'all', nissim: 'finance', aviv: 'realestate' }

export async function buildWeeklyReport(asOf: string, audience: Audience = 'dan'): Promise<WeeklyReportData> {
  const start = weekStart(asOf)
  const end = addDays(start, 6)
  const prevStart = addDays(start, -7)
  const division = DIVISION_FOR[audience]
  const showBank = audience === 'dan'
  const month = monthOf(asOf)
  const prevMonth = addMonths(month, -1)
  const dayOfMonth = Number(asOf.slice(8, 10))
  const divFilter = division === 'all' ? null : division

  const [weekTx, mtdPnl, prevMtd, target, nissimCard, advances, coll, moved, signed, leadRows, exceptions, fixed, budgets, account] = await Promise.all([
    sql<{ collected: number; out: number }[]>`
      select coalesce(sum(amount_net) filter (where nature = 'income'), 0) as collected,
             coalesce(abs(sum(amount_net) filter (where nature = 'expense')), 0) as out
      from v_tx_classified where date_cash between ${start} and ${end} and certainty = 'actual'
        and (${divFilter}::text is null or division = ${divFilter})`,
    sql<{ mode: string; income: number; fixed_expenses: number; direct_expenses: number; profit: number }[]>`
      select mode, coalesce(income,0) as income, coalesce(fixed_expenses,0) as fixed_expenses,
             coalesce(direct_expenses,0) as direct_expenses, coalesce(profit,0) as profit
      from v_pnl where month = ${month} and division = ${divFilter ?? 'finance'}`,
    sql<{ collected: number }[]>`
      select coalesce(sum(amount_net), 0) as collected from v_tx_classified
      where nature = 'income' and certainty = 'actual' and to_char(date_cash, 'YYYY-MM') = ${prevMonth}
        and extract(day from date_cash) <= ${dayOfMonth} and (${divFilter}::text is null or division = ${divFilter})`,
    sql<{ value: number }[]>`select (value #>> '{}')::numeric as value from settings where key = 'monthly_profit_target'`,
    sql<{ line4_distributable_profit: number; line5_nissim_share: number; line6_advances: number; line7_closing_balance: number }[]>`
      select line4_distributable_profit, line5_nissim_share, line6_advances, line7_closing_balance from v_nissim_card where month = ${month}`,
    sql<{ amount: number }[]>`select coalesce(sum(amount_gross), 0) as amount from advances where period = ${month} and deleted_at is null`,
    sql<{ client_name: string; open_amount: number; open_committed: number; open_expected: number; days_overdue: number; next_missing: string | null }[]>`
      select client_name, open_amount, open_committed, open_expected, days_overdue::int, next_missing
      from v_collections_ops where (${divFilter}::text is null or division = ${divFilter}) order by open_amount desc`,
    sql<{ moved_in: number; new_open: number; rotted: number }[]>`
      select
        coalesce((select sum(t.amount_net) from v_tx_classified t where t.nature = 'income' and t.certainty = 'actual'
                  and t.date_cash between ${start} and ${end} and t.deal_id is not null
                  and (${divFilter}::text is null or t.division = ${divFilter})), 0) as moved_in,
        coalesce((select sum(d.fee_agreed_net) from deals d where d.created_at::date between ${start} and ${end} and d.deleted_at is null
                  and (${divFilter}::text is null or d.division = ${divFilter})), 0) as new_open,
        (select count(*)::int from deals d where d.status = 'open' and d.deleted_at is null and d.last_activity_at::date <= ${addDays(asOf, -30)}
                  and (${divFilter}::text is null or d.division = ${divFilter})) as rotted`,
    sql<{ signed: number; amount: number; lost: number }[]>`
      select count(*) filter (where d.stage not in ('prospect'))::int as signed,
             coalesce(sum(d.fee_agreed_net) filter (where d.stage not in ('prospect')), 0) as amount,
             count(*) filter (where d.status = 'lost')::int as lost
      from deals d where d.created_at::date between ${start} and ${end} and d.deleted_at is null
        and (${divFilter}::text is null or d.division = ${divFilter})`,
    sql<{ channel: string; leads: number; signings: number; cost: number }[]>`
      select coalesce(source_name, 'ללא ערוץ') as channel, sum(leads)::int as leads, sum(signings)::int as signings, coalesce(sum(lead_cost), 0) as cost
      from v_conversion where week = ${start} group by 1 order by 2 desc`,
    sql<{ missing_invoices: number; missing_vat: number; unknown_tx: number }[]>`
      select
        (select count(*)::int from transactions where invoice_status in ('missing','unknown') and nature in ('income','expense')
           and deleted_at is null and certainty = 'actual' and to_char(date_cash,'YYYY-MM') = ${month}) as missing_invoices,
        (select coalesce(sum(input_vat_missing_invoice), 0) from v_vat where vat_month = ${month}) as missing_vat,
        (select count(*)::int from transactions where review_status <> 'ok' and deleted_at is null) as unknown_tx`,
    sql<{ name: string }[]>`
      select f.name from fixed_expenses f
      where f.active and f.deleted_at is null and f.frequency = 'monthly'
        and make_date(${Number(month.slice(0, 4))}, ${Number(month.slice(5, 7))}, least(f.day_of_month, 28)) < current_date - 5
        and not exists (select 1 from transactions t where t.fixed_expense_id = f.id and to_char(t.date_cash,'YYYY-MM') = ${month} and t.deleted_at is null)`,
    sql<{ name: string; over: number }[]>`
      select c.name, (coalesce((select abs(sum(t.amount_net)) from v_tx_classified t where t.category_id = b.category_id
             and t.nature = 'expense' and to_char(t.date_cash,'YYYY-MM') = b.period), 0) - b.amount_net) as over
      from budgets b join categories c on c.id = b.category_id
      where b.period = ${month} and b.deleted_at is null
        and coalesce((select abs(sum(t.amount_net)) from v_tx_classified t where t.category_id = b.category_id
             and t.nature = 'expense' and to_char(t.date_cash,'YYYY-MM') = b.period), 0) > b.amount_net`,
    bankAccount(),
  ])

  const anchorEnd = account && showBank ? await latestAnchor(account.id, end) : null
  const anchorStart = account && showBank ? await latestAnchor(account.id, addDays(start, -1)) : null
  // סעיף 7 הוא "13 שבועות **קדימה**" — הוא נשען על העוגן העדכני, לא על עוגן השבוע המדווח.
  const latest = account && showBank ? await latestAnchor(account.id) : null
  const cf = latest ? await loadCashflow(latest.date > asOf ? latest.date : asOf) : null
  const ok = cf && !('error' in cf) ? cf : null

  const op = mtdPnl.find((m) => m.mode === 'operational')
  const dist = mtdPnl.find((m) => m.mode === 'distributable')
  const collected = Number(weekTx[0]?.collected ?? 0)
  const out = Number(weekTx[0]?.out ?? 0)
  const leads = leadRows.reduce((a, r) => a + r.leads, 0)
  const signings = leadRows.reduce((a, r) => a + r.signings, 0)

  const nextStart = addDays(end, 1)
  const nextEnd = addDays(end, 7)
  const items = ok?.items ?? []

  return {
    weekStart: start, weekEnd: end, audience, division, showBank,
    week: {
      collected, out, operationalProfit: Math.round((collected - out) * 100) / 100,
      netCashflow: Math.round((collected - out) * 100) / 100,
      balanceStart: anchorStart?.balance ?? null, balanceEnd: anchorEnd?.balance ?? null,
    },
    mtd: {
      month, collected: Number(op?.income ?? 0), target: target[0]?.value ?? null, prevSamePoint: Number(prevMtd[0]?.collected ?? 0),
      operational: Number(op?.profit ?? 0), distributable: Number(dist?.profit ?? 0),
      income: Number(op?.income ?? 0), fixed: Number(op?.fixed_expenses ?? 0), direct: Number(op?.direct_expenses ?? 0),
    },
    nissim: audience === 'aviv' || !nissimCard[0] ? null : {
      month, distributable: nissimCard[0].line4_distributable_profit, share: nissimCard[0].line5_nissim_share,
      advances: Number(advances[0]?.amount ?? 0), estimatedBalance: nissimCard[0].line7_closing_balance,
    },
    collections: {
      committed: coll.reduce((a, r) => a + r.open_committed, 0), expected: coll.reduce((a, r) => a + r.open_expected, 0),
      top: coll.slice(0, 5).map((r) => ({ client: r.client_name, amount: r.open_amount, daysOverdue: r.days_overdue, missing: r.next_missing })),
      movedIn: Number(moved[0]?.moved_in ?? 0), newOpen: Number(moved[0]?.new_open ?? 0), rotted: Number(moved[0]?.rotted ?? 0),
    },
    pipeline: {
      signedThisWeek: signed[0]?.signed ?? 0, signedAmount: Number(signed[0]?.amount ?? 0), lostThisWeek: signed[0]?.lost ?? 0,
      leads, conversionPct: leads ? Math.round((signings / leads) * 1000) / 10 : 0,
      byChannel: leadRows.map((r) => ({ channel: r.channel, leads: r.leads, signings: r.signings, cost: Number(r.cost) })),
    },
    cashflow: ok ? {
      weeks: ok.result.weeks.slice(0, 13).map((w) => ({ label: `${w.weekStart.slice(8, 10)}/${Number(w.weekStart.slice(5, 7))}`, committed: w.balanceCommitted, weighted: w.balanceWeighted })),
      lowPoint: ok.result.lowPoint,
    } : null,
    exceptions: {
      missingInvoices: exceptions[0]?.missing_invoices ?? 0, missingVat: Number(exceptions[0]?.missing_vat ?? 0),
      unknownTx: exceptions[0]?.unknown_tx ?? 0, fixedNotDebited: fixed.map((f) => f.name),
      budgetOverruns: budgets.map((b) => ({ name: b.name, over: Number(b.over) })),
    },
    nextWeek: {
      charges: items.filter((i) => i.amount < 0 && i.date >= nextStart && i.date <= nextEnd).sort((a, b) => a.amount - b.amount).slice(0, 6).map((i) => ({ date: i.date, label: i.label, amount: i.amount })),
      receipts: items.filter((i) => i.amount > 0 && i.certainty === 'committed' && i.date >= nextStart && i.date <= nextEnd).slice(0, 6).map((i) => ({ date: i.date, label: i.label, amount: i.amount })),
      events: [],
    },
  }
}

// ── רינדור ─────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const d = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const M = (v: number, color = true) => `<span dir="ltr" style="font-variant-numeric:tabular-nums${color && v < 0 ? ';color:#DC2626' : ''}">${formatMoney(v)}</span>`

const AUDIENCE_LABEL: Record<Audience, string> = { dan: 'דן', nissim: 'ניסים — מימון', aviv: 'אביב — נדל"ן' }

export function renderWeeklyHtml(r: WeeklyReportData, baseUrl = ''): string {
  const L = (path: string, text: string) => (baseUrl ? `<a href="${baseUrl}${path}" style="color:#0F766E;text-decoration:none">${esc(text)}</a>` : esc(text))
  const h2 = (t: string) => `<h2 style="font-size:13px;margin:14px 0 4px;color:#6B7280;border-bottom:1px solid #E6E8EC;padding-bottom:2px">${t}</h2>`
  const row = (cells: string[]) => `<tr>${cells.map((c, i) => `<td style="padding:3px 6px;${i ? 'text-align:left' : ''}">${c}</td>`).join('')}</tr>`
  const table = (rows: string[]) => `<table style="width:100%;border-collapse:collapse;font-size:12px">${rows.join('')}</table>`
  const empty = (t: string) => `<p style="margin:2px 0;color:#9CA3AF;font-size:12px">${t}</p>`

  const mtdPct = r.mtd.target ? Math.round((r.mtd.distributable / r.mtd.target) * 100) : null
  const deltaPrev = r.mtd.collected - r.mtd.prevSamePoint

  const sections: string[] = []

  sections.push(h2('1. השבוע במספרים') + table([
    row(['נגבה', M(r.week.collected)]),
    row(['יצא', M(-r.week.out)]),
    row(['רווח תפעולי לשבוע', M(r.week.operationalProfit)]),
    ...(r.showBank ? [
      row(['יתרה תחילת שבוע', r.week.balanceStart === null ? '—' : M(r.week.balanceStart)]),
      row(['יתרה סוף שבוע', r.week.balanceEnd === null ? '—' : M(r.week.balanceEnd)]),
    ] : []),
  ]))

  sections.push(h2('2. חודש עד כה') + table([
    row([`נגבה ${r.mtd.month}`, M(r.mtd.collected)]),
    row(['מול אותו שלב בחודש הקודם', `${deltaPrev >= 0 ? '+' : ''}${formatMoney(deltaPrev)}`]),
    ...(r.mtd.target ? [row(['מול היעד החודשי', `${M(r.mtd.target)} · ${mtdPct}%`])] : []),
  ]))

  sections.push(h2('3. רווח והפסד MTD — שתי ההגדרות') + table([
    row(['הכנסות', M(r.mtd.income)]),
    row(['הוצאות קבועות', M(-r.mtd.fixed)]),
    row(['הוצאות ישירות', M(-r.mtd.direct)]),
    row(['<b>רווח תפעולי</b>', `<b>${M(r.mtd.operational)}</b>`]),
    row(['<b>רווח לחלוקה</b>', `<b>${M(r.mtd.distributable)}</b>`]),
  ]) + `<p style="font-size:11px;color:#9CA3AF;margin:2px 0">תפעולי = כל ההוצאות · לחלוקה = מוכרות ומאושרות בלבד (§3.2)</p>`)

  if (r.nissim) {
    sections.push(h2('4. התחשבנות ניסים — מצב ביניים (לא סגור)') + table([
      row(['רווח לחלוקה MTD', M(r.nissim.distributable)]),
      row(['חלק ניסים משוער', M(r.nissim.share)]),
      row(['מקדמות שנמשכו', M(r.nissim.advances)]),
      row(['<b>יתרה משוערת</b>', `<b>${M(r.nissim.estimatedBalance)}</b>`]),
    ]))
  }

  sections.push(h2('5. גביה') + table([
    row(['פתוח ודאי', M(r.collections.committed)]),
    row(['פתוח פוטנציאלי', M(r.collections.expected)]),
    row(['נגבה השבוע', M(r.collections.movedIn)]),
    row(['נפתח השבוע', M(r.collections.newOpen)]),
    row(['תיקים נרקבים', String(r.collections.rotted)]),
  ]) + (r.collections.top.length
    ? table(r.collections.top.map((t) => row([`${esc(t.client)}${t.missing ? ` <span style="color:#F59E0B">· חסר: ${esc(t.missing)}</span>` : ''}${t.daysOverdue ? ` <span style="color:#DC2626">· ${t.daysOverdue} ימי איחור</span>` : ''}`, M(t.amount)])))
    : empty('אין יתרות פתוחות')))

  sections.push(h2('6. פייפליין והמרה') + table([
    row(['נחתם השבוע', `${r.pipeline.signedThisWeek} · ${formatMoney(r.pipeline.signedAmount)}`]),
    row(['נסגר (אבוד)', String(r.pipeline.lostThisWeek)]),
    row(['לידים השבוע', String(r.pipeline.leads)]),
    row(['יחס המרה', `${r.pipeline.conversionPct}%`]),
  ]) + (r.pipeline.byChannel.length
    ? table(r.pipeline.byChannel.map((c) => row([esc(c.channel), `${c.leads} לידים · ${c.signings} חתימות · ${formatMoney(c.cost)}`])))
    : empty('אין נתוני לידים לשבוע (ייבוא WISE — שלב 8)')))

  if (r.cashflow) {
    const w = r.cashflow.weeks
    const max = Math.max(1, ...w.map((x) => Math.abs(x.committed)))
    const bars = w.map((x) => {
      const h = Math.round((Math.abs(x.committed) / max) * 36)
      return `<td style="vertical-align:bottom;text-align:center;padding:0 1px"><div style="height:${h}px;background:${x.committed < 0 ? '#DC2626' : '#2563EB'};width:14px;margin:0 auto"></div><div style="font-size:8px;color:#9CA3AF">${x.label}</div></td>`
    }).join('')
    sections.push(h2('7. 13 שבועות קדימה') + `<table style="width:100%"><tr>${bars}</tr></table>` +
      (r.cashflow.lowPoint ? `<p style="font-size:12px;margin:4px 0">נקודה נמוכה: ${M(r.cashflow.lowPoint.balance)} ב-${d(r.cashflow.lowPoint.date)}</p>` : ''))
  }

  const ex = r.exceptions
  const exRows = [
    ex.missingInvoices ? row(['חשבוניות חסרות', `${ex.missingInvoices} · ${formatMoney(ex.missingVat)} מע"מ בסיכון`]) : '',
    ex.unknownTx ? row(['תנועות לא מזוהות', String(ex.unknownTx)]) : '',
    ex.fixedNotDebited.length ? row(['הוצאות קבועות שלא ירדו', esc(ex.fixedNotDebited.join(', '))]) : '',
    ...ex.budgetOverruns.map((b) => row([`חריגת תקציב — ${esc(b.name)}`, M(-b.over)])),
  ].filter(Boolean)
  sections.push(h2('8. חריגים') + (exRows.length ? table(exRows) : empty('אין חריגים ✓')))

  sections.push(h2('9. לשבוע הבא') +
    (r.nextWeek.charges.length ? `<p style="font-size:12px;margin:2px 0"><b>חיובים גדולים</b></p>` + table(r.nextWeek.charges.map((c) => row([`${d(c.date)} · ${esc(c.label)}`, M(c.amount)]))) : empty('אין חיובים גדולים')) +
    (r.nextWeek.receipts.length ? `<p style="font-size:12px;margin:6px 0 2px"><b>תקבולים ודאיים</b></p>` + table(r.nextWeek.receipts.map((c) => row([`${d(c.date)} · ${esc(c.label)}`, M(c.amount)]))) : ''))

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח שבועי ${d(r.weekStart)}–${d(r.weekEnd)}</title></head>
<body style="margin:0;background:#F7F8FA;font-family:Heebo,Assistant,Arial,sans-serif;color:#111827;font-size:13px">
<div style="max-width:720px;margin:0 auto;background:#fff;padding:20px">
  <h1 style="font-size:18px;margin:0">הר-אל · דוח כספי שבועי</h1>
  <div style="color:#6B7280;font-size:12px;margin-bottom:6px">
    ${d(r.weekStart)}–${d(r.weekEnd)}/${r.weekEnd.slice(0, 4)} · ${AUDIENCE_LABEL[r.audience]}
    ${r.showBank ? '' : ' · ללא יתרת בנק (SPEC §6)'} · ${L('/', 'למערכת')}
  </div>
  ${sections.join('')}
  <p style="font-size:11px;color:#9CA3AF;margin-top:16px">הופק אוטומטית (ADDENDUM ב.7).</p>
</div></body></html>`
}
