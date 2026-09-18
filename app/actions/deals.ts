'use server'

import { revalidatePath } from 'next/cache'
import { withActor } from '@/lib/db'
import { instantiateChecklist } from '@/lib/rules/checklist.js'

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(fd: FormData, k: string): number | null {
  const v = str(fd, k)
  if (v === null) return null
  const n = Number(v.replace(/[,\s₪]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * תיק חדש — מימון בלבד (החלטה 3 + הבהרת דן: נדל"ן = כסף, לא תפעול).
 * יוצר גם את צ'קליסט הביצוע מהתבנית (ADDENDUM ב.5).
 */
export async function createDeal(fd: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const clientName = str(fd, 'client_name')
  const product = str(fd, 'product')
  const feeAgreed = num(fd, 'fee_agreed_net') ?? 0
  const advance = num(fd, 'advance_at_signing_net')
  const phone = str(fd, 'client_phone')
  const stage = str(fd, 'stage') ?? 'prospect'
  const signedAt = str(fd, 'signed_at')
  const monthAttributed = str(fd, 'month_attributed')
  const notes = str(fd, 'notes')

  if (!clientName || !product) return { ok: false, error: 'שם לקוח ומוצר הם שדות חובה' }

  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into deals (client_name, client_phone, division, product, stage, fee_agreed_net,
                           advance_at_signing_net, signed_at, month_attributed, notes, last_activity_at)
        values (${clientName}, ${phone}, 'finance', ${product}, ${stage}, ${feeAgreed},
                ${advance}, ${signedAt}, ${monthAttributed}, ${notes}, now())
        returning id`
      const dealId = row!.id
      const items = instantiateChecklist(dealId, product)
      for (const it of items) {
        await tx`insert into deal_checklist_items (deal_id, sort_order, label) values (${dealId}, ${it.sortOrder}, ${it.label})`
      }
      // SPEC §2.1 — מקדמה בחתימה כשורת תקבול צפוי
      if (advance && advance > 0 && signedAt) {
        await tx`insert into deal_payments_plan (deal_id, label, amount_net, expected_date, certainty, probability)
                 values (${dealId}, 'מקדמה בחתימה', ${advance}, ${signedAt}, 'committed', 1)`
      }
      return dealId
    })
    revalidatePath('/deals')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function updateDealStage(id: string, patch: { stage?: string; collection_status?: string; status?: string; month_attributed?: string | null }) {
  try {
    await withActor(async (tx) => {
      await tx`update deals set ${tx({ ...patch, last_activity_at: new Date() })} where id = ${id} and deleted_at is null`
    })
    revalidatePath('/deals'); revalidatePath(`/deals/${id}`)
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}

/** לוח תקבולים — SPEC §2.1 deal_payments_plan: "כל שורה נושאת את הודאות שלה בנפרד". */
export async function addPaymentPlan(fd: FormData) {
  const dealId = str(fd, 'deal_id'); const label = str(fd, 'label'); const amount = num(fd, 'amount_net')
  const date = str(fd, 'expected_date'); const certainty = str(fd, 'certainty') ?? 'expected'
  const probability = num(fd, 'probability') ?? (certainty === 'committed' ? 1 : 0.5)
  if (!dealId || !label || amount === null || !date) return { ok: false as const, error: 'חסרים שדות' }
  try {
    await withActor(async (tx) => {
      await tx`insert into deal_payments_plan (deal_id, label, amount_net, expected_date, certainty, probability)
               values (${dealId}, ${label}, ${amount}, ${date}, ${certainty}, ${certainty === 'committed' ? 1 : probability})`
    })
    revalidatePath(`/deals/${dealId}`)
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}

export async function setChecklistItem(id: string, dealId: string, status: string, blockedReason?: string) {
  try {
    await withActor(async (tx) => {
      await tx`update deal_checklist_items
               set status = ${status}, blocked_reason = ${status === 'blocked' ? (blockedReason ?? 'לא צוין') : null},
                   status_since = current_date
               where id = ${id}`
      await tx`update deals set last_activity_at = now() where id = ${dealId}`
    })
    revalidatePath(`/deals/${dealId}`)
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}

/**
 * עסקת נדל"ן — כסף בלבד (הבהרת דן): לקוח, סכום עסקה, אחוזים, סטטוס.
 * שכ"ט = סכום × 2% (ללא מע"מ). עמלת יזם מוזנת "כולל מע"מ" ומפורקת לנטו —
 * כי כך היא נסגרת מול היזם, ובמערכת הכל נטו (SPEC §1.4).
 */
export async function createRealEstateDeal(fd: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const clientName = str(fd, 'client_name')
  const baseAmount = num(fd, 'base_amount')
  const feePct = (num(fd, 'fee_pct') ?? 2) / 100
  const devPctIncl = (num(fd, 'developer_pct_incl') ?? 1) / 100
  const openingFee = num(fd, 'opening_fee_net')
  const vatRate = num(fd, 'vat_rate') ?? 0.18
  const stage = str(fd, 'stage') === 'closed' ? 're_contract_signed' : 're_lead'
  const signedAt = str(fd, 'signed_at')
  const expectedClose = str(fd, 'expected_close_date')
  const notes = str(fd, 'notes')
  if (!clientName || baseAmount === null) return { ok: false, error: 'שם לקוח וסכום עסקה הם שדות חובה' }

  const feeNet = Math.round(baseAmount * feePct * 100) / 100
  const devGross = baseAmount * devPctIncl
  const devNet = Math.round((devGross / (1 + vatRate)) * 100) / 100

  try {
    const id = await withActor(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into deals (client_name, division, product, stage, status, fee_mode, fee_pct, base_amount,
                           fee_agreed_net, opening_fee_net, developer_commission_net, signed_at,
                           expected_close_date, notes, last_activity_at)
        values (${clientName}, 'realestate', 'presale', ${stage}, ${stage === 're_contract_signed' ? 'won' : 'open'},
                'pct_of_property', ${feePct}, ${baseAmount}, ${feeNet}, ${openingFee}, ${devNet},
                ${signedAt}, ${expectedClose}, ${notes}, now())
        returning id`
      const dealId = row!.id
      // לוח תקבולים (SPEC §2.1): שכ"ט בחתימה; עמלת יזם שוטף+30.
      const anchor = signedAt ?? expectedClose
      if (anchor) {
        const certainty = stage === 're_contract_signed' ? 'committed' : 'expected'
        const prob = certainty === 'committed' ? 1 : 0.3
        await tx`insert into deal_payments_plan (deal_id, label, amount_net, expected_date, certainty, probability)
                 values (${dealId}, 'שכ"ט 2%', ${feeNet}, ${anchor}, ${certainty}, ${prob})`
        if (openingFee && openingFee > 0) {
          await tx`insert into deal_payments_plan (deal_id, label, amount_net, expected_date, certainty, probability)
                   values (${dealId}, 'דמי פתיחה', ${openingFee}, ${anchor}, ${certainty}, ${prob})`
        }
        if (devNet > 0) {
          await tx`insert into deal_payments_plan (deal_id, label, amount_net, expected_date, certainty, probability)
                   values (${dealId}, 'עמלת יזם (שוטף+30)', ${devNet}, (${anchor}::date + 30), ${certainty}, ${prob})`
        }
      }
      return dealId
    })
    revalidatePath('/deals')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function setRealEstateDealClosed(id: string, closed: boolean, signedAt?: string) {
  try {
    await withActor(async (tx) => {
      await tx`update deals set stage = ${closed ? 're_contract_signed' : 're_lead'}, status = ${closed ? 'won' : 'open'},
               signed_at = coalesce(${signedAt ?? null}::date, signed_at), last_activity_at = now()
               where id = ${id} and division = 'realestate' and deleted_at is null`
      await tx`update deal_payments_plan set certainty = ${closed ? 'committed' : 'expected'}, probability = ${closed ? 1 : 0.3}
               where deal_id = ${id} and matched_tx_id is null and deleted_at is null`
    })
    revalidatePath('/deals')
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
}
